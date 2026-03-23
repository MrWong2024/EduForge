export type AiSubmissionAnalysisContext = {
  submissionId: string;
  classroomTaskId?: string;
  attemptNo: number;
  language: string;
  codeText: string;
  aiUsageDeclaration?: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskRubric?: Record<string, unknown>;
};
