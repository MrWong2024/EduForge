import { WithId } from '../../../common/types/with-id.type';
import { Model, Types } from 'mongoose';
import { Classroom } from '../../classrooms/schemas/classroom.schema';
import { ClassroomTask } from '../../classrooms/classroom-tasks/schemas/classroom-task.schema';

// Applied before pagination, counts, distinct students and feedback aggregation.
// Callers still enforce the existing template-author permission.
export async function teacherSubmissionScope(
  taskId: string,
  teacherId: string,
  classrooms: Model<Classroom>,
  classroomTasks: Model<ClassroomTask>,
): Promise<Record<string, unknown>> {
  const classroomIds = (
    await classrooms
      .find({ teacherId: new Types.ObjectId(teacherId) })
      .select('_id')
      .lean<WithId[]>()
      .exec()
  ).map((item) => item._id);
  const instanceIds = (
    await classroomTasks
      .find({
        classroomId: { $in: classroomIds },
        taskId: new Types.ObjectId(taskId),
      })
      .select('_id')
      .lean<WithId[]>()
      .exec()
  ).map((item) => item._id);
  return {
    taskId: new Types.ObjectId(taskId),
    $or: [{ classroomTaskId: { $in: instanceIds } }, { classroomTaskId: null }],
  };
}
