import { PublicTaskContent } from '../classroom-task-content';
import { ClassroomTask } from '../schemas/classroom-task.schema';
import { TaskStatus } from '../../../learning-tasks/schemas/task.schema';
import { ClassroomTaskStatus } from '../classroom-task-status.constants';

export class ClassroomTaskResponseDto {
  id!: string;
  classroomId!: string;
  taskId!: string;
  taskSnapshotAvailable!: boolean;
  status!: ClassroomTaskStatus;
  publishedAt!: Date;
  dueAt?: Date;
  settings?: ClassroomTask['settings'];
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
  taskPublisher?: {
    id: string;
    name?: string;
  } | null;
  task!: PublicTaskContent & {
    status: TaskStatus;
  };
}
