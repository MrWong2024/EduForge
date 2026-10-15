import type { AiContextFile } from '../../ai-context/ai-context.types';

export type AiSubmissionAnalysisContext = {
  submissionId: string;
  classroomTaskId?: string;
  attemptNo: number;
  language: string;
  codeText: string;
  submissionNote?: string;
  aiUsageDeclaration?: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskRubric?: Record<string, unknown>;
  referenceFiles?: AiContextFile[];
};
