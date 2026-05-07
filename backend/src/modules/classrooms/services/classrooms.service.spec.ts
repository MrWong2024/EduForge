import { Types } from 'mongoose';
import { ClassroomStatus } from '../schemas/classroom.schema';
import { ClassroomsService } from './classrooms.service';

const objectId = () => new Types.ObjectId();

const makeQuery = <T>(result: T) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

const createService = ({
  classrooms = [],
  courses = [],
  userRoles = ['teacher'],
}: {
  classrooms?: Array<Record<string, unknown>>;
  courses?: Array<Record<string, unknown>>;
  userRoles?: string[];
}) => {
  const classroomFindQuery = makeQuery(classrooms);
  const classroomFindByIdQuery = makeQuery(classrooms[0] ?? null);
  const courseFindQuery = makeQuery(courses);
  const courseFindByIdQuery = makeQuery(courses[0] ?? null);
  const userFindByIdQuery = makeQuery({ roles: userRoles });
  const classroomModel = {
    find: jest.fn().mockReturnValue(classroomFindQuery),
    findById: jest.fn().mockReturnValue(classroomFindByIdQuery),
    countDocuments: jest.fn().mockResolvedValue(classrooms.length),
  };
  const courseModel = {
    find: jest.fn().mockReturnValue(courseFindQuery),
    findById: jest.fn().mockReturnValue(courseFindByIdQuery),
  };
  const userModel = {
    findById: jest.fn().mockReturnValue(userFindByIdQuery),
  };
  const enrollmentService = {
    listActiveStudentIds: jest.fn().mockResolvedValue([]),
    isStudentActiveInClassroom: jest.fn().mockResolvedValue(true),
  };

  const service = new ClassroomsService(
    classroomModel as never,
    {} as never,
    {} as never,
    courseModel as never,
    userModel as never,
    enrollmentService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    classroomModel,
    courseModel,
    courseFindQuery,
    courseFindByIdQuery,
    enrollmentService,
  };
};

describe('ClassroomsService classroom responses', () => {
  it('returns courseId and course summary for classroom detail', async () => {
    const classroomId = objectId();
    const courseId = objectId();
    const teacherId = objectId();
    const classroom = {
      _id: classroomId,
      courseId,
      name: 'Class A',
      teacherId,
      joinCode: 'ABC123',
      status: ClassroomStatus.Active,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const course = {
      _id: courseId,
      code: 'CS101',
      name: 'Intro CS',
      term: '2026 Spring',
      courseLabel: 'programming',
      status: 'ACTIVE',
      createdBy: teacherId,
    };
    const { service, courseFindByIdQuery } = createService({
      classrooms: [classroom],
      courses: [course],
    });

    const result = await service.getClassroom(
      classroomId.toString(),
      teacherId.toString(),
    );

    expect(result.courseId).toBe(courseId.toString());
    expect(result.course).toEqual({
      id: courseId.toString(),
      code: 'CS101',
      name: 'Intro CS',
      term: '2026 Spring',
      courseLabel: 'programming',
      status: 'ACTIVE',
    });
    expect(result.course).not.toHaveProperty('createdBy');
    expect(result.course).not.toHaveProperty('_id');
    expect(courseFindByIdQuery.select).toHaveBeenCalledWith(
      '_id code name term courseLabel status',
    );
  });

  it('batch loads course summaries for classroom list items', async () => {
    const teacherId = objectId();
    const courseIdA = objectId();
    const courseIdB = objectId();
    const classrooms = [
      {
        _id: objectId(),
        courseId: courseIdA,
        name: 'Class A',
        teacherId,
        joinCode: 'A12345',
        status: ClassroomStatus.Active,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        _id: objectId(),
        courseId: courseIdB,
        name: 'Class B',
        teacherId,
        joinCode: 'B12345',
        status: ClassroomStatus.Active,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ];
    const courses = [
      {
        _id: courseIdA,
        code: 'CS101',
        name: 'Intro CS',
        term: '2026 Spring',
        status: 'ACTIVE',
      },
      {
        _id: courseIdB,
        code: 'CS102',
        name: 'Data Structures',
        term: '2026 Spring',
        courseLabel: 'programming',
        status: 'ARCHIVED',
      },
    ];
    const { service, courseModel, courseFindQuery } = createService({
      classrooms,
      courses,
    });

    const result = await service.listClassrooms({}, teacherId.toString());

    expect(result.items).toHaveLength(2);
    expect(result.items[0].course).toMatchObject({
      id: courseIdA.toString(),
      name: 'Intro CS',
      code: 'CS101',
    });
    expect(result.items[1].course).toMatchObject({
      id: courseIdB.toString(),
      name: 'Data Structures',
      courseLabel: 'programming',
      status: 'ARCHIVED',
    });
    expect(courseModel.find).toHaveBeenCalledTimes(1);
    expect(courseFindQuery.select).toHaveBeenCalledWith(
      '_id code name term courseLabel status',
    );
  });

  it('keeps courseId when the referenced course is missing', async () => {
    const classroomId = objectId();
    const courseId = objectId();
    const teacherId = objectId();
    const classroom = {
      _id: classroomId,
      courseId,
      name: 'Class A',
      teacherId,
      joinCode: 'ABC123',
      status: ClassroomStatus.Active,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const { service } = createService({
      classrooms: [classroom],
      courses: [],
    });

    const result = await service.getClassroom(
      classroomId.toString(),
      teacherId.toString(),
    );

    expect(result.courseId).toBe(courseId.toString());
    expect(result.course).toBeUndefined();
  });
});
