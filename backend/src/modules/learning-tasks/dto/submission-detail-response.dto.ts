import { AiReviewSummary } from '../ai-feedback/lib/ai-review-summary';
import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';
import { SubmissionEditing } from './submission-response.dto';

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
  contentRevision!: number | null;
  lastEditedAt!: Date | null;
  lastEditIsLate!: boolean | null;
  reviewStartedAt!: Date | null;
  editing!: SubmissionEditing;
  isLate!: boolean;
  lateBySeconds!: number;
  aiFeedbackStatus!: AiFeedbackStatus;
  aiReview!: AiReviewSummary;
}
