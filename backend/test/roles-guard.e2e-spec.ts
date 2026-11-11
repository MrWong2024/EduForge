import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/auth.constants';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { CoursesController } from '../src/modules/courses/controllers/courses.controller';
import { CourseOverviewService } from '../src/modules/courses/services/course-overview.service';
import { CoursesService } from '../src/modules/courses/services/courses.service';

type SessionUser = NonNullable<
  Awaited<ReturnType<AuthService['validateSession']>>
>;

describe('RolesGuard retirement boundary (HTTP, no database)', () => {
  const identities: Record<'teacher' | 'admin' | 'student', SessionUser> = {
    teacher: { id: 'synthetic-teacher-id', roles: ['teacher'] },
    admin: { id: 'synthetic-admin-id', roles: ['admin'] },
    student: { id: 'synthetic-student-id', roles: ['student'] },
  };
  const sessions: Record<string, SessionUser> = {
    'synthetic-teacher-session': identities.teacher,
    'synthetic-admin-session': identities.admin,
    'synthetic-student-session': identities.student,
  };
  const validateSession = jest.fn(
    (token?: string): ReturnType<AuthService['validateSession']> =>
      Promise.resolve(sessions[token ?? ''] ?? null),
  );
  const courseList: Awaited<ReturnType<CoursesService['listCourses']>> = {
    items: [],
    total: 0,
    page: 1,
    limit: 20,
  };
  const listCourses = jest
    .fn<
      ReturnType<CoursesService['listCourses']>,
      Parameters<CoursesService['listCourses']>
    >()
    .mockResolvedValue(courseList);
  const getCourseOverview = jest.fn<
    ReturnType<CourseOverviewService['getCourseOverview']>,
    Parameters<CourseOverviewService['getCourseOverview']>
  >();

  // These providers never load environment files or initialize real Services.
  const configService = {
    get(key: string): string | undefined {
      if (key === 'AUTHZ_ENFORCE_ROLES') return 'false';
      if (key === 'app.frontendUrl') return 'http://127.0.0.1:43127';
      return undefined;
    },
  };

  async function withApplication(
    verify: (app: INestApplication<App>) => Promise<void>,
  ): Promise<void> {
    const moduleFixture = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [
        RolesGuard,
        AllExceptionsFilter,
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        { provide: AuthService, useValue: { validateSession } },
        { provide: CoursesService, useValue: { listCourses } },
        { provide: CourseOverviewService, useValue: { getCourseOverview } },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    let app: INestApplication<App> | undefined;
    try {
      app = moduleFixture.createNestApplication<INestApplication<App>>();
      configureApp(app);
      await app.init();
      await verify(app);
    } finally {
      if (app) await app.close();
      else await moduleFixture.close();
    }
  }

  beforeEach(() => {
    validateSession.mockClear();
    listCourses.mockClear();
    getCourseOverview.mockClear();
  });

  it.each(['teacher', 'admin'] as const)(
    'allows %s through the real course metadata and passes the identity ID',
    async (role) => {
      await withApplication(async (app) => {
        const token = `synthetic-${role}-session`;
        await request(app.getHttpServer())
          .get('/api/courses')
          .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)
          .timeout({ response: 5000, deadline: 10000 })
          .expect(200)
          .expect(courseList);

        expect(validateSession).toHaveBeenCalledTimes(1);
        expect(validateSession).toHaveBeenCalledWith(token);
        expect(listCourses).toHaveBeenCalledTimes(1);
        expect(listCourses).toHaveBeenCalledWith({}, identities[role].id);
        expect(getCourseOverview).not.toHaveBeenCalled();
      });
    },
  );

  it('rejects a student even when the retired switch is false', async () => {
    await withApplication(async (app) => {
      const response = await request(app.getHttpServer())
        .get('/api/courses')
        .set('Cookie', `${SESSION_COOKIE_NAME}=synthetic-student-session`)
        .timeout({ response: 5000, deadline: 10000 })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Forbidden resource',
        path: '/api/courses',
      });
      expect(validateSession).toHaveBeenCalledTimes(1);
      expect(validateSession).toHaveBeenCalledWith('synthetic-student-session');
      expect(listCourses).not.toHaveBeenCalled();
      expect(getCourseOverview).not.toHaveBeenCalled();
    });
  });

  it('returns 401 before course authorization when no Cookie is present', async () => {
    await withApplication(async (app) => {
      const response = await request(app.getHttpServer())
        .get('/api/courses')
        .timeout({ response: 5000, deadline: 10000 })
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        message: 'Unauthorized',
        path: '/api/courses',
      });
      expect(validateSession).not.toHaveBeenCalled();
      expect(listCourses).not.toHaveBeenCalled();
      expect(getCourseOverview).not.toHaveBeenCalled();
    });
  });
});
