import {
  type CommonIssuesReport,
  type Feedback,
  type FeedbackSeverity,
  type Job,
  type JobStatus,
  type Submission,
  type SubmissionWithStatus,
  type Task,
} from "./demo-types";

export type DemoStore = {
  tasks: Task[];
  submissions: Submission[];
  jobs: Job[];
  feedback: Feedback[];
  createTask: (input: { title: string; description: string }) => Task;
  publishTask: (id: string) => Task | null;
  createSubmission: (input: {
    taskId: string;
    studentId: string;
    codeText: string;
  }) => { submission: Submission; job: Job };
  getSubmissions: (input: {
    taskId?: string | null;
    studentId?: string | null;
  }) => SubmissionWithStatus[];
  getJobs: (input: { status?: JobStatus | null; limit?: number | null }) => Job[];
  processOnce: (batchSize?: number) => {
    processed: number;
    succeeded: number;
    failed: number;
    dead: number;
    batchSize: number;
  };
  getCommonIssuesReport: (taskId: string) => CommonIssuesReport;
};

type DemoStoreState = {
  counters: {
    task: number;
    submission: number;
    job: number;
    feedback: number;
  };
};

const nowIso = () => new Date().toISOString();

const seedTask = (): Task => ({
  id: "task-1001",
  title: "多态基础：动物叫声",
  description: "使用继承与多态实现动物叫声，注意结构与可读性。",
  status: "DRAFT",
  createdAt: nowIso(),
});

const getExcerpt = (text: string, max = 80) =>
  text.trim().slice(0, max).replace(/\s+/g, " ");

const generateFeedback = (submission: Submission) => {
  const normalized = submission.codeText.toLowerCase();
  const hasIf = normalized.includes("if");
  const hasElse = normalized.includes("else");
  const hasChain = hasIf && hasElse;
  const tooShort = submission.codeText.trim().length < 40 || normalized.includes("todo");

  let severity: FeedbackSeverity = "INFO";
  let types: string[] = ["READABILITY"];
  let tags: string[] = ["readability", "robustness", "testability"];
  let summary = "结构整体清晰，但可以进一步提升健壮性。";
  let details = "建议补充边界条件处理与更清晰的命名。";

  if (hasChain) {
    severity = "WARN";
    types = ["DESIGN"];
    tags = ["polymorphism", "readability", "duplication"];
    summary = "存在较多 if-else 分支，影响可维护性。";
    details = "建议引入多态/策略模式减少重复条件判断。";
  } else if (tooShort) {
    severity = "WARN";
    types = ["CORRECTNESS"];
    tags = ["edge-cases", "correctness"];
    summary = "代码较短或包含 TODO，边界情况不足。";
    details = "请补充异常处理与测试覆盖，避免遗漏场景。";
  }

  return {
    severity,
    types,
    tags,
    summary,
    details,
  };
};

const initStore = (): DemoStore => {
  const state: DemoStoreState = {
    counters: {
      task: 1001,
      submission: 2000,
      job: 3000,
      feedback: 4000,
    },
  };

  const tasks: Task[] = [seedTask()];
  const submissions: Submission[] = [];
  const jobs: Job[] = [];
  const feedback: Feedback[] = [];

  const nextId = (prefix: string, key: keyof DemoStoreState["counters"]) => {
    state.counters[key] += 1;
    return `${prefix}-${state.counters[key]}`;
  };

  const createTask = (input: { title: string; description: string }) => {
    const task: Task = {
      id: nextId("task", "task"),
      title: input.title,
      description: input.description,
      status: "DRAFT",
      createdAt: nowIso(),
    };
    tasks.unshift(task);
    return task;
  };

  const publishTask = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return null;
    if (task.status === "PUBLISHED") return task;
    task.status = "PUBLISHED";
    task.publishedAt = nowIso();
    return task;
  };

  const createSubmission = (input: {
    taskId: string;
    studentId: string;
    codeText: string;
  }) => {
    const task = tasks.find((item) => item.id === input.taskId);
    if (!task || task.status !== "PUBLISHED") {
      throw new Error("任务未发布，无法提交。");
    }

    const submission: Submission = {
      id: nextId("sub", "submission"),
      taskId: input.taskId,
      studentId: input.studentId,
      codeText: input.codeText,
      createdAt: nowIso(),
    };
    submissions.unshift(submission);

    const job: Job = {
      id: nextId("job", "job"),
      submissionId: submission.id,
      taskId: submission.taskId,
      studentId: submission.studentId,
      status: "PENDING",
      createdAt: nowIso(),
    };
    jobs.unshift(job);

    return { submission, job };
  };

  const getSubmissions = (input: {
    taskId?: string | null;
    studentId?: string | null;
  }): SubmissionWithStatus[] => {
    return submissions
      .filter((item) => (input.taskId ? item.taskId === input.taskId : true))
      .filter((item) => (input.studentId ? item.studentId === input.studentId : true))
      .map((item) => {
        const job = jobs.find((jobItem) => jobItem.submissionId === item.id);
        return {
          ...item,
          aiFeedbackStatus: job?.status ?? "NONE",
        };
      });
  };

  const getJobs = (input: { status?: JobStatus | null; limit?: number | null }) => {
    const filtered = input.status
      ? jobs.filter((item) => item.status === input.status)
      : jobs;
    if (input.limit && input.limit > 0) {
      return filtered.slice(0, input.limit);
    }
    return filtered;
  };

  const processOnce = (batchSize = 3) => {
    const pending = jobs.filter((item) => item.status === "PENDING").slice(0, batchSize);
    const processed = pending.length;

    pending.forEach((job) => {
      job.status = "RUNNING";
      job.startedAt = nowIso();
      const submission = submissions.find((item) => item.id === job.submissionId);
      if (!submission) {
        job.status = "FAILED";
        job.finishedAt = nowIso();
        return;
      }
      const feedbackPayload = generateFeedback(submission);
      const feedbackItem: Feedback = {
        id: nextId("fb", "feedback"),
        submissionId: submission.id,
        taskId: submission.taskId,
        studentId: submission.studentId,
        severity: feedbackPayload.severity,
        types: feedbackPayload.types,
        tags: feedbackPayload.tags,
        summary: feedbackPayload.summary,
        details: feedbackPayload.details,
        createdAt: nowIso(),
      };
      feedback.unshift(feedbackItem);
      job.status = "SUCCEEDED";
      job.finishedAt = nowIso();
    });

    const succeeded = pending.filter((item) => item.status === "SUCCEEDED").length;
    const failed = pending.filter((item) => item.status === "FAILED").length;

    return {
      processed,
      succeeded,
      failed,
      dead: 0,
      batchSize,
    };
  };

  const getCommonIssuesReport = (taskId: string): CommonIssuesReport => {
    const submissionsForTask = submissions.filter((item) => item.taskId === taskId);
    const feedbackForTask = feedback.filter((item) => item.taskId === taskId);

    const tagMap = new Map<string, { count: number; severityBreakdown: Record<FeedbackSeverity, number> }>();
    const examplesMap = new Map<string, CommonIssuesReport["examples"][number]>();

    feedbackForTask.forEach((item) => {
      item.tags.forEach((tag) => {
        const existing = tagMap.get(tag) ?? {
          count: 0,
          severityBreakdown: { INFO: 0, WARN: 0, ERROR: 0 },
        };
        existing.count += 1;
        existing.severityBreakdown[item.severity] += 1;
        tagMap.set(tag, existing);

        const submission = submissions.find((sub) => sub.id === item.submissionId);
        const excerpt = submission ? getExcerpt(submission.codeText) : "";
        const samples = examplesMap.get(tag) ?? { tag, samples: [] };
        if (samples.samples.length < 3) {
          samples.samples.push({
            submissionId: item.submissionId,
            studentId: item.studentId,
            severity: item.severity,
            excerpt,
          });
        }
        examplesMap.set(tag, samples);
      });
    });

    const topTags = Array.from(tagMap.entries())
      .map(([tag, data]) => ({ tag, count: data.count, severityBreakdown: data.severityBreakdown }))
      .sort((a, b) => b.count - a.count);

    return {
      taskId,
      summary: {
        submissionsCount: submissionsForTask.length,
        distinctStudentsCount: new Set(submissionsForTask.map((item) => item.studentId)).size,
      },
      topTags,
      examples: Array.from(examplesMap.values()),
    };
  };

  return {
    tasks,
    submissions,
    jobs,
    feedback,
    createTask,
    publishTask,
    createSubmission,
    getSubmissions,
    getJobs,
    processOnce,
    getCommonIssuesReport,
  };
};

if (!globalThis.__EDUFORGE_DEMO_STORE__) {
  globalThis.__EDUFORGE_DEMO_STORE__ = initStore();
}

export const demoStore = globalThis.__EDUFORGE_DEMO_STORE__;

declare global {
  // eslint-disable-next-line no-var
  var __EDUFORGE_DEMO_STORE__: DemoStore | undefined;
}

export {};
