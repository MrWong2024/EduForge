import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test, TestingModule } from '@nestjs/testing';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

class RouteTargets {
  @Roles('teacher', 'admin')
  teachers(this: void) {
    return 'teachers';
  }

  @Roles('student')
  students(this: void) {
    return 'students';
  }

  unannotated(this: void) {
    return 'unannotated';
  }

  @Public()
  public(this: void) {
    return 'public';
  }
}

@Roles('teacher', 'admin')
class ClassRoleTargets {
  inherited(this: void) {
    return 'inherited';
  }

  @Roles('student')
  overridden(this: void) {
    return 'overridden';
  }
}

type GuardRequest = { user?: { id: string; roles?: string[] } };

function context(
  handler: () => string,
  request: GuardRequest = {},
  controller: typeof RouteTargets | typeof ClassRoleTargets = RouteTargets,
) {
  return new ExecutionContextHost([request], controller, handler);
}

describe('RolesGuard (no I/O)', () => {
  let module: TestingModule | undefined;
  let guard: RolesGuard;
  let previousEnforcement: string | undefined;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();
    guard = module.get(RolesGuard);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(() => {
    previousEnforcement = process.env.AUTHZ_ENFORCE_ROLES;
  });

  afterEach(() => {
    if (previousEnforcement === undefined) {
      delete process.env.AUTHZ_ENFORCE_ROLES;
    } else {
      process.env.AUTHZ_ENFORCE_ROLES = previousEnforcement;
    }
  });

  function expectForbidden(entry: ExecutionContextHost) {
    let error: unknown;
    try {
      guard.canActivate(entry);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error).toMatchObject({
      status: 403,
      message: 'Forbidden resource',
    });
  }

  it('resolves with Reflector and without ConfigService', () => {
    expect(guard).toBeInstanceOf(RolesGuard);
  });

  it.each(['teacher', 'admin'])(
    'allows %s on an entry declaring teacher and admin',
    (role) => {
      expect(
        guard.canActivate(
          context(RouteTargets.prototype.teachers, {
            user: { id: 'unit-user', roles: [role] },
          }),
        ),
      ).toBe(true);
    },
  );

  it('rejects student on an entry declaring teacher and admin', () => {
    expectForbidden(
      context(RouteTargets.prototype.teachers, {
        user: { id: 'unit-user', roles: ['student'] },
      }),
    );
  });

  it('does not grant admin an implicit bypass on a student-only entry', () => {
    expectForbidden(
      context(RouteTargets.prototype.students, {
        user: { id: 'unit-user', roles: ['admin'] },
      }),
    );
  });

  it.each<{ label: string; request: GuardRequest }>([
    {
      label: 'empty roles',
      request: { user: { id: 'unit-user', roles: [] } },
    },
    {
      label: 'unknown roles',
      request: { user: { id: 'unit-user', roles: ['unknown'] } },
    },
    { label: 'missing roles', request: { user: { id: 'unit-user' } } },
    { label: 'missing user', request: {} },
  ])('rejects $label on a protected entry', ({ request }) => {
    expectForbidden(context(RouteTargets.prototype.teachers, request));
  });

  it('rejects a non-Public entry without role metadata', () => {
    expectForbidden(
      context(RouteTargets.prototype.unannotated, {
        user: { id: 'unit-user', roles: ['teacher', 'admin'] },
      }),
    );
  });

  it('uses class-level roles when a method has no role metadata', () => {
    expect(
      guard.canActivate(
        context(
          ClassRoleTargets.prototype.inherited,
          { user: { id: 'unit-user', roles: ['teacher'] } },
          ClassRoleTargets,
        ),
      ),
    ).toBe(true);
  });

  it.each([
    { role: 'student', allowed: true },
    { role: 'teacher', allowed: false },
  ])(
    'uses method-level roles instead of class roles for $role',
    ({ role, allowed }) => {
      const entry = context(
        ClassRoleTargets.prototype.overridden,
        { user: { id: 'unit-user', roles: [role] } },
        ClassRoleTargets,
      );
      if (allowed) {
        expect(guard.canActivate(entry)).toBe(true);
      } else {
        expectForbidden(entry);
      }
    },
  );

  it('allows a Public entry without a user or role metadata', () => {
    expect(guard.canActivate(context(RouteTargets.prototype.public))).toBe(
      true,
    );
  });

  it('rejects mismatched roles even when the obsolete env key is false', () => {
    process.env.AUTHZ_ENFORCE_ROLES = 'false';
    expectForbidden(
      context(RouteTargets.prototype.teachers, {
        user: { id: 'unit-user', roles: ['student'] },
      }),
    );
  });

  it('rejects missing role metadata even when the obsolete env key is false', () => {
    process.env.AUTHZ_ENFORCE_ROLES = 'false';
    expectForbidden(
      context(RouteTargets.prototype.unannotated, {
        user: { id: 'unit-user', roles: ['admin'] },
      }),
    );
  });
});
