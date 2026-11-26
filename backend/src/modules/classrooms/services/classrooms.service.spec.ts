import { mongo, Types } from 'mongoose';
import { Course } from '../../courses/schemas/course.schema';
import { Classroom, ClassroomStatus } from '../schemas/classroom.schema';
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
  transactionConnection,
}: {
  classrooms?: Array<Record<string, unknown>>;
  courses?: Array<Record<string, unknown>>;
  userRoles?: string[];
  transactionConnection?: unknown;
}) => {
  const classroomFindQuery = makeQuery(classrooms);
  const classroomFindByIdQuery = makeQuery(classrooms[0] ?? null);
  const courseFindQuery = makeQuery(courses);
  const courseFindByIdQuery = makeQuery(courses[0] ?? null);
  const userFindByIdQuery = makeQuery({ roles: userRoles });
  const classroomModel = {
    modelName: Classroom.name,
    find: jest.fn().mockReturnValue(classroomFindQuery),
    findById: jest.fn().mockReturnValue(classroomFindByIdQuery),
    countDocuments: jest.fn().mockResolvedValue(classrooms.length),
  };
  const courseModel = {
    modelName: Course.name,
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
    {} as never,
    transactionConnection as never,
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

const makeSession = () => ({
  startTransaction: jest.fn(),
  inTransaction: jest.fn().mockReturnValue(true),
  commitTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  abortTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  endSession: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
});

const setupClassroomCreation = () => {
  const courseId = objectId();
  const teacherId = objectId();
  const classroomId = objectId();
  const courseQuery = makeQuery({
    _id: courseId,
    code: 'CS101',
    name: 'Intro CS',
    term: '2026 Spring',
    status: 'ARCHIVED',
  });
  const updateCourse = jest.fn().mockReturnValue(courseQuery);
  const insertClassroom = jest.fn<
    Promise<Array<Classroom & { _id: Types.ObjectId }>>,
    [Classroom[], { session: ReturnType<typeof makeSession> }]
  >(([classroom]) => Promise.resolve([{ ...classroom, _id: classroomId }]));
  const sessions = Array.from({ length: 8 }, makeSession);
  const startSession = jest.fn<Promise<ReturnType<typeof makeSession>>, []>();
  for (const session of sessions) startSession.mockResolvedValueOnce(session);
  const models = {
    [Course.name]: { findOneAndUpdate: updateCourse },
    [Classroom.name]: { create: insertClassroom },
  };
  const { service } = createService({
    transactionConnection: {
      startSession,
      models,
      model: (name: string) => models[name],
    },
  });
  const create = () =>
    service.createClassroom(
      { courseId: courseId.toString(), name: 'Class A' },
      teacherId.toString(),
    );
  return {
    create,
    courseId,
    teacherId,
    sessions,
    startSession,
    updateCourse,
    insertClassroom,
  };
};

function duplicateKey(keyPattern: Record<string, number>) {
  return new mongo.MongoServerError({
    code: 11000,
    errmsg: 'duplicate key',
    keyPattern,
  });
}

describe('ClassroomsService createClassroom transaction', () => {
  it('aborts a join-code collision before using a fresh session and code', async () => {
    const {
      create,
      courseId,
      teacherId,
      sessions,
      startSession,
      updateCourse,
      insertClassroom,
    } = setupClassroomCreation();
    const [firstSession, secondSession] = sessions;
    const collision = duplicateKey({ joinCode: 1 });
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    insertClassroom.mockImplementationOnce(() => {
      random.mockReturnValue(0.5);
      return Promise.reject(collision);
    });
    try {
      await expect(create()).resolves.toMatchObject({
        courseId: courseId.toString(),
        course: { id: courseId.toString(), status: 'ARCHIVED' },
      });
    } finally {
      random.mockRestore();
    }

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(updateCourse).toHaveBeenNthCalledWith(
      1,
      { _id: courseId.toString(), createdBy: teacherId },
      { $inc: { __v: 1 } },
      expect.objectContaining({ session: firstSession, timestamps: false }),
    );
    expect(updateCourse).toHaveBeenNthCalledWith(
      2,
      { _id: courseId.toString(), createdBy: teacherId },
      { $inc: { __v: 1 } },
      expect.objectContaining({ session: secondSession, timestamps: false }),
    );
    expect(firstSession.abortTransaction).toHaveBeenCalledTimes(1);
    expect(firstSession.commitTransaction).not.toHaveBeenCalled();
    expect(firstSession.endSession.mock.invocationCallOrder[0]).toBeLessThan(
      secondSession.startTransaction.mock.invocationCallOrder[0],
    );
    const [[firstClassrooms, firstOptions], [secondClassrooms, secondOptions]] =
      insertClassroom.mock.calls;
    expect(firstOptions.session).toBe(firstSession);
    expect(secondOptions.session).toBe(secondSession);
    expect(secondClassrooms[0].joinCode).not.toBe(firstClassrooms[0].joinCode);
    expect(secondSession.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('rethrows the insert error after eight join-code collisions', async () => {
    const { create, sessions, startSession, insertClassroom } =
      setupClassroomCreation();
    const collision = duplicateKey({ joinCode: 1 });
    insertClassroom.mockRejectedValue(collision);

    await expect(create()).rejects.toBe(collision);
    expect(startSession).toHaveBeenCalledTimes(8);
    expect(insertClassroom).toHaveBeenCalledTimes(8);
    for (const session of sessions) {
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(session.commitTransaction).not.toHaveBeenCalled();
    }
  });

  it('does not retry an insert collision on a different unique key', async () => {
    const { create, startSession, insertClassroom } = setupClassroomCreation();
    const collision = duplicateKey({ _id: 1 });
    insertClassroom.mockRejectedValue(collision);

    await expect(create()).rejects.toBe(collision);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(insertClassroom).toHaveBeenCalledTimes(1);
  });

  it('does not replay an insert when confirming the commit remains inconclusive', async () => {
    const { create, sessions, startSession, insertClassroom } =
      setupClassroomCreation();
    const uncertainCommit = duplicateKey({ joinCode: 1 });
    uncertainCommit.addErrorLabel(
      mongo.MongoErrorLabel.UnknownTransactionCommitResult,
    );
    sessions[0].commitTransaction.mockRejectedValue(uncertainCommit);

    await expect(create()).rejects.toBe(uncertainCommit);
    expect(sessions[0].commitTransaction).toHaveBeenCalledTimes(2);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(insertClassroom).toHaveBeenCalledTimes(1);
  });
});

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
