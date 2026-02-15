import { TaskStatus } from '../schemas/task.schema';

export class TaskResponseDto {
  id!: string;
  title!: string;
  description!: string;
  knowledgeModule!: string;
  stage!: number;
  difficulty?: string;
  rubric?: Record<string, unknown>;
  status!: TaskStatus;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
  publishedAt?: Date;
}
