import { AiReviewSummary } from '../ai-feedback/lib/ai-review-summary';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';

export class SubmissionDetailResponseDto {
  id!: string;
  taskId!: string;
  classroomTaskId!: string | null;
  studentId!: string;
  studentName!: string | null;
  taskTitle!: string | null;
  taskSnapshotAvailable!: boolean;
  language!: string | null;
  content!: {
    language: string | null;
    codeText: string | null;
    submissionNote: string;
  };
  meta?: { aiUsageDeclaration?: string };
  submittedAt!: Date | null;
  attemptNo!: number | null;
  isLate!: boolean;
  lateBySeconds!: number;
  aiFeedbackStatus!: AiFeedbackStatus;
  aiReview!: AiReviewSummary;
}
