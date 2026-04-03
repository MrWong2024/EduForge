import { TaskStatus } from '../../../learning-tasks/schemas/task.schema';
import type { TaskVisibility } from '../../../learning-tasks/task-template-visibility.constants';

export class PublishableTaskTemplateItemResponseDto {
  id!: string;
  title!: string;
  description!: string;
  knowledgeModule!: string;
  courseLabel?: string;
  visibility!: TaskVisibility;
  stage!: number;
  difficulty?: string;
  status!: TaskStatus;
  createdBy!: string;
  createdById!: string;
  createdAt!: Date;
  updatedAt!: Date;
  publishedAt?: Date;
}

export class PublishableTaskTemplateListResponseDto {
  items!: PublishableTaskTemplateItemResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
