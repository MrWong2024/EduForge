import { ClassroomTask } from '../schemas/classroom-task.schema';
import { TaskStatus } from '../../../learning-tasks/schemas/task.schema';

export class ClassroomTaskResponseDto {
  id!: string;
  classroomId!: string;
  taskId!: string;
  publishedAt!: Date;
  dueAt?: Date;
  settings?: ClassroomTask['settings'];
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
  task!: {
    title: string;
    description: string;
    knowledgeModule: string;
    stage: number;
    difficulty?: string;
    status: TaskStatus;
  };
}
