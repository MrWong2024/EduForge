export type TaskStatus = "DRAFT" | "PUBLISHED";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type FeedbackSeverity = "INFO" | "WARN" | "ERROR";

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  publishedAt?: string;
};

export type Submission = {
  id: string;
  taskId: string;
  studentId: string;
  codeText: string;
  createdAt: string;
};

export type SubmissionWithStatus = Submission & {
  aiFeedbackStatus: JobStatus | "NONE";
};

export type Job = {
  id: string;
  submissionId: string;
  taskId: string;
  studentId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type Feedback = {
  id: string;
  submissionId: string;
  taskId: string;
  studentId: string;
  severity: FeedbackSeverity;
  types: string[];
  tags: string[];
  summary: string;
  details: string;
  createdAt: string;
};

export type TagBreakdown = {
  tag: string;
  count: number;
  severityBreakdown: Record<FeedbackSeverity, number>;
};

export type TagExample = {
  tag: string;
  samples: Array<{
    submissionId: string;
    studentId: string;
    severity: FeedbackSeverity;
    excerpt: string;
  }>;
};

export type CommonIssuesReport = {
  taskId: string;
  summary: {
    submissionsCount: number;
    distinctStudentsCount: number;
  };
  topTags: TagBreakdown[];
  examples: TagExample[];
};
