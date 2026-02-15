import { SubmissionStatus } from '../schemas/submission.schema';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';

export class SubmissionResponseDto {
  id!: string;
  taskId!: string;
  classroomTaskId?: string;
  studentId!: string;
  attemptNo!: number;
  content!: {
    codeText: string;
    language: string;
  };
  meta?: {
    aiUsageDeclaration?: string;
  };
  status!: SubmissionStatus;
  aiFeedbackStatus!: AiFeedbackStatus;
  createdAt!: Date;
  updatedAt!: Date;
}
