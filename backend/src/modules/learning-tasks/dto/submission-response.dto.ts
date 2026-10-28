import { SubmissionStatus } from '../schemas/submission.schema';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';

export type SubmissionEditing = {
  canEdit: boolean;
  reason: string | null;
  message: string | null;
};

export class SubmissionResponseDto {
  id!: string;
  taskId!: string;
  classroomTaskId?: string;
  studentId!: string;
  attemptNo!: number;
  contentRevision!: number | null;
  lastEditedAt!: Date | null;
  lastEditIsLate!: boolean | null;
  reviewStartedAt!: Date | null;
  editing!: SubmissionEditing;
  content!: {
    codeText: string;
    language: string;
    submissionNote: string;
  };
  meta?: {
    aiUsageDeclaration?: string;
  };
  status!: SubmissionStatus;
  aiFeedbackStatus!: AiFeedbackStatus;
  submittedAt!: Date;
  isLate!: boolean;
  lateBySeconds!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
