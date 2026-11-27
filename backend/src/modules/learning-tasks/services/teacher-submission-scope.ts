import { WithId } from '../../../common/types/with-id.type';
import type { ClassroomReadSnapshot } from '../../../lib/classroom-task-transaction';
import { Model, Types } from 'mongoose';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';
import { Submission } from '../schemas/submission.schema';

type ScopedSubmissionCounts = {
  submissionsCount: number;
  distinctStudentsCount: number;
};

// Applied before pagination, counts, distinct students and feedback aggregation.
// Callers still enforce the existing template-author permission.
export async function teacherSubmissionScope(
  taskId: string,
  teacherId: string,
  classrooms: Model<Classroom>,
  classroomTasks: Model<ClassroomTask>,
  snapshot?: ClassroomReadSnapshot,
): Promise<Record<string, unknown>> {
  const classroomQuery = (snapshot?.model(classrooms) ?? classrooms)
    .find({ teacherId: new Types.ObjectId(teacherId) })
    .select('_id')
    .lean<WithId[]>();
  if (snapshot) {
    classroomQuery.session(snapshot.session).setOptions(snapshot.readOptions());
  }
  const classroomIds = (await classroomQuery.exec()).map((item) => item._id);
  const instanceQuery = (snapshot?.model(classroomTasks) ?? classroomTasks)
    .find({
      classroomId: { $in: classroomIds },
      taskId: new Types.ObjectId(taskId),
    })
    .select('_id')
    .lean<WithId[]>();
  if (snapshot) {
    instanceQuery.session(snapshot.session).setOptions(snapshot.readOptions());
  }
  const instanceIds = (await instanceQuery.exec()).map((item) => item._id);
  return {
    taskId: new Types.ObjectId(taskId),
    classroomTaskId: { $in: instanceIds },
    $expr: { $eq: [{ $type: '$classroomTaskId' }, 'objectId'] },
  };
}

export async function aggregateScopedSubmissionCounts(
  submissions: Model<Submission>,
  filter: Record<string, unknown>,
  snapshot: ClassroomReadSnapshot,
): Promise<ScopedSubmissionCounts> {
  const [counts] = await snapshot
    .model(submissions)
    .aggregate<ScopedSubmissionCounts>([
      { $match: filter },
      { $group: { _id: '$studentId', submissionsCount: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          submissionsCount: { $sum: '$submissionsCount' },
          distinctStudentsCount: { $sum: 1 },
        },
      },
    ])
    .option({ session: snapshot.session, ...snapshot.readOptions() })
    .exec();

  return {
    submissionsCount: counts?.submissionsCount ?? 0,
    distinctStudentsCount: counts?.distinctStudentsCount ?? 0,
  };
}
