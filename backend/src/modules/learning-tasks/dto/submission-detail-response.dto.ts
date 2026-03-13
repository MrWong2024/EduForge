import { AiFeedbackStatus } from '../ai-feedback/interfaces/ai-feedback-status.enum';

export class SubmissionDetailResponseDto {
  id!: string;
  taskId!: string;
  classroomTaskId!: string | null;
  studentId!: string;
  studentName!: string | null;
  taskTitle!: string | null;
  language!: string | null;
  content!: {
    language: string | null;
    codeText: string | null;
  };
  submittedAt!: Date | null;
  attemptNo!: number | null;
  isLate!: boolean;
  lateBySeconds!: number;
  aiFeedbackStatus!: AiFeedbackStatus;
}
