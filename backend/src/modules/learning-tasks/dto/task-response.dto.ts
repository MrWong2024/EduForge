import { TaskStatus } from '../schemas/task.schema';
import type { TaskVisibility } from '../task-template-visibility.constants';

import type { AiContextRef } from '../ai-context/ai-context.types';

export class TaskResponseDto {
  aiContextRefs?: AiContextRef[];
  id!: string;
  title!: string;
  description!: string;
  knowledgeModule!: string;
  courseLabel?: string;
  visibility!: TaskVisibility;
  stage!: number;
  difficulty?: string;
  rubric?: Record<string, unknown>;
  status!: TaskStatus;
  createdBy!: string;
  publisher?: {
    id: string;
    name?: string;
  } | null;
  createdAt!: Date;
  updatedAt!: Date;
  publishedAt?: Date;
}
