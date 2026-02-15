import {
  FeedbackSeverity,
  FeedbackSource,
  FeedbackType,
} from '../schemas/feedback.schema';

export class FeedbackResponseDto {
  id!: string;
  submissionId!: string;
  source!: FeedbackSource;
  type!: FeedbackType;
  severity!: FeedbackSeverity;
  message!: string;
  suggestion?: string;
  tags?: string[];
  scoreHint?: number;
  createdAt!: Date;
  updatedAt!: Date;
}
