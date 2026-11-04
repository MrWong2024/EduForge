"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toLearningTaskUpdateResponse,
  type LearningTaskDetailResponse,
  type LearningTaskStatus,
  type UpdateLearningTaskRequest,
} from "@/lib/api/types-teacher";
import {
  TASK_COURSE_LABEL_FORM_OPTIONS,
  TASK_COURSE_LABEL_UNCLASSIFIED,
  normalizeTaskCourseLabel,
} from "@/lib/learning-tasks/course-labels";
import {
  TASK_DIFFICULTY_HELP,
  TASK_DIFFICULTY_OPTIONS,
  getDifficultyLabel,
  toDifficultyInputValue,
  updateDifficultyPayload,
} from "@/lib/learning-tasks/difficulty";
import {
  TASK_TEMPLATE_VISIBILITIES,
  TASK_TEMPLATE_VISIBILITY_LABELS,
  TASK_TEMPLATE_VISIBILITY_SHARED,
  normalizeTaskTemplateVisibility,
  type TaskTemplateVisibility,
} from "@/lib/learning-tasks/template-visibility-scope";
import { toSafeTaskListReturnTo } from "@/lib/routes/task-list-return-to";
import { getPublisherLabel } from "@/lib/ui/format";
import { getTaskTemplateStatusLabel } from "@/lib/ui/status";
import {
  buildUpdateTaskRubric,
  getRubricNotes,
} from "@/lib/learning-tasks/rubric";
import {
  TaskAiContextRefsEditor,
  TaskAiContextRefsReadOnly,
} from "@/components/teacher/TaskAiContextRefs";
import {
  buildAiContextRefsPatch,
  canEditTaskTemplate,
  formatAiContextRefs,
} from "@/lib/learning-tasks/ai-context-refs";

type EditLearningTaskFormProps = {
  taskId: string;
  initialTask: LearningTaskDetailResponse;
  readOnly?: boolean;
  currentUserId?: string;
  returnTo?: string;
};

type EditLearningTaskFormErrorState = {
  status?: number;
  title?: string;
  description: string;
};

type TaskLifecycleAction = "publish" | "archive";

const USED_PUBLISHED_TEMPLATE_REVERT_DETAIL =
  "Published task templates used by classrooms cannot be changed back to draft";

const USED_PUBLISHED_TEMPLATE_REVERT_MESSAGE =
  "该模板已发布到班级，不能改回草稿。若需要停止学生提交，请到对应班级任务中关闭任务。";

const isLearningTaskStatus = (value: string): value is LearningTaskStatus =>
  value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED";

const toRawStatusUpper = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const getUpdateErrorSummary = (status: number): string => {
  if (status === 400) {
    return "更新参数不合法，或当前模板状态不允许更新。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限编辑该任务模板。";
  }
  if (status === 404) {
    return "任务模板不存在或功能未启用/不可用。";
  }
  if (status >= 500) {
    return "更新任务模板失败，请稍后重试。";
  }
  return "更新任务模板失败，请稍后重试。";
};

const buildUpdateErrorDescription = (
  status: number,
  detail?: string,
): string => {
  if (detail?.includes(USED_PUBLISHED_TEMPLATE_REVERT_DETAIL)) {
    return USED_PUBLISHED_TEMPLATE_REVERT_MESSAGE;
  }
  return buildErrorDescription(getUpdateErrorSummary(status), detail);
};

const getLifecycleActionErrorSummary = (
  action: TaskLifecycleAction,
  status: number,
): string => {
  if (action === "publish") {
    if (status === 400) {
      return "当前模板状态不允许发布。";
    }
    if (status === 401) {
      return "登录状态已失效，请重新登录。";
    }
    if (status === 403) {
      return "无权限发布该任务模板。";
    }
    if (status === 404) {
      return "任务模板不存在或已不可用。";
    }
    if (status >= 500) {
      return "发布任务模板失败，请稍后重试。";
    }
    return "发布任务模板失败，请稍后重试。";
  }

  if (status === 400) {
    return "当前模板状态不允许归档。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限归档该任务模板。";
  }
  if (status === 404) {
    return "任务模板不存在或已不可用。";
  }
  if (status >= 500) {
    return "归档任务模板失败，请稍后重试。";
  }
  return "归档任务模板失败，请稍后重试。";
};

export function EditLearningTaskForm({
  taskId,
  initialTask,
  readOnly = false,
  currentUserId,
  returnTo,
}: EditLearningTaskFormProps) {
  const router = useRouter();
  const taskListReturnTo = toSafeTaskListReturnTo(returnTo);
  const initialCourseLabel = normalizeTaskCourseLabel(initialTask.courseLabel);
  const rawInitialStatus = toRawStatusUpper(initialTask.status);
  const hasKnownInitialStatus = isLearningTaskStatus(rawInitialStatus);
  const initialVisibility =
    normalizeTaskTemplateVisibility(initialTask.visibility) ??
    TASK_TEMPLATE_VISIBILITY_SHARED;
  const publisherLabel = getPublisherLabel(
    initialTask.publisher,
    currentUserId,
  );

  const [title, setTitle] = useState(initialTask.title ?? "");
  const [description, setDescription] = useState(initialTask.description ?? "");
  const [knowledgeModule, setKnowledgeModule] = useState(
    initialTask.knowledgeModule ?? "",
  );
  const [difficultyBaseline, setDifficultyBaseline] = useState(
    initialTask.difficulty,
  );
  const [difficulty, setDifficulty] = useState(() =>
    toDifficultyInputValue(initialTask.difficulty),
  );
  const [courseLabel, setCourseLabel] = useState(
    initialCourseLabel && initialCourseLabel !== TASK_COURSE_LABEL_UNCLASSIFIED
      ? initialCourseLabel
      : "",
  );
  const [currentStatus, setCurrentStatus] = useState<LearningTaskStatus>(
    hasKnownInitialStatus ? rawInitialStatus : "DRAFT",
  );
  const [visibility, setVisibility] =
    useState<TaskTemplateVisibility>(initialVisibility);
  const [rubricNotes, setRubricNotes] = useState(() =>
    getRubricNotes(initialTask.rubric),
  );
  const [showAiContextEditor] = useState(
    () => (initialTask.aiContextRefs?.length ?? 0) > 0,
  );
  const [aiContextBaseline, setAiContextBaseline] = useState(
    initialTask.aiContextRefs ?? [],
  );
  const [aiContextText, setAiContextText] = useState(() =>
    formatAiContextRefs(initialTask.aiContextRefs ?? []),
  );
  const [aiContextError, setAiContextError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] =
    useState<EditLearningTaskFormErrorState | null>(null);

  const isArchived = currentStatus === "ARCHIVED";
  const ownerCanEdit = canEditTaskTemplate(
    currentUserId,
    initialTask.createdById,
    hasKnownInitialStatus ? currentStatus : undefined,
  );
  const canPublish = !readOnly && ownerCanEdit && currentStatus === "DRAFT";
  const canArchive = !readOnly && ownerCanEdit && currentStatus === "PUBLISHED";
  const isActionPending = isPublishing || isArchiving;
  const effectiveReadOnly = readOnly || !ownerCanEdit;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (effectiveReadOnly || isSubmitting || isActionPending) {
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedKnowledgeModule = knowledgeModule.trim();
    const normalizedCourseLabel = normalizeTaskCourseLabel(courseLabel);
    if (!trimmedTitle) {
      setErrorState({
        description: "请填写任务模板标题。",
      });
      return;
    }
    if (!trimmedDescription) {
      setErrorState({
        description: "请填写任务模板描述。",
      });
      return;
    }
    if (!trimmedKnowledgeModule) {
      setErrorState({
        description: "请填写知识模块。",
      });
      return;
    }
    let aiContextPatch: Pick<UpdateLearningTaskRequest, "aiContextRefs">;
    try {
      aiContextPatch = buildAiContextRefsPatch(
        aiContextText,
        aiContextBaseline,
      );
    } catch (error) {
      setAiContextError(
        error instanceof Error ? error.message : "引用 JSON 不合法。",
      );
      return;
    }
    setAiContextError(null);
    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const requestBody: UpdateLearningTaskRequest = {
      title: trimmedTitle,
      description: trimmedDescription,
      knowledgeModule: trimmedKnowledgeModule,
      courseLabel: normalizedCourseLabel ?? "",
      visibility,
      rubric: buildUpdateTaskRubric(rubricNotes),
      ...aiContextPatch,
      ...updateDifficultyPayload(difficultyBaseline, difficulty),
    };

    try {
      const payload = await fetchJson<unknown>(
        `learning-tasks/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      const updated = toLearningTaskUpdateResponse(payload);
      if (
        updated.id !== taskId ||
        "aiContextRefs" in
          buildAiContextRefsPatch(aiContextText, updated.aiContextRefs ?? [])
      ) {
        throw new Error("保存结果无法确认");
      }
      setAiContextBaseline(updated.aiContextRefs ?? []);
      setDifficultyBaseline(updated.difficulty);
      setDifficulty(toDifficultyInputValue(updated.difficulty));
      setRubricNotes(getRubricNotes(updated.rubric));
      const suffix = "，评阅标准已更新。";
      setSuccessMessage(`任务模板更新成功${suffix}`);
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          description: buildUpdateErrorDescription(error.status, detail),
        });
      } else {
        setErrorState({
          description: "更新任务模板失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLifecycleAction = async (action: TaskLifecycleAction) => {
    if (effectiveReadOnly || isSubmitting || isActionPending) {
      return;
    }

    if (action === "publish" && !canPublish) {
      return;
    }
    if (action === "archive" && !canArchive) {
      return;
    }

    const confirmed = window.confirm(
      action === "publish"
        ? "确认发布该任务模板吗？发布后，该模板将进入班级发布候选列表，可被用于创建课堂任务。"
        : "确认归档该任务模板吗？归档后，该模板将不再出现在班级发布候选列表中；已经发布到班级的课堂任务、学生提交和统计数据不受影响。",
    );
    if (!confirmed) {
      return;
    }

    if (action === "publish") {
      setIsPublishing(true);
    } else {
      setIsArchiving(true);
    }
    setSuccessMessage(null);
    setErrorState(null);

    try {
      await fetchJson<unknown>(
        `learning-tasks/tasks/${encodeURIComponent(taskId)}/${action}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
          },
        },
      );
      const nextStatus = action === "publish" ? "PUBLISHED" : "ARCHIVED";
      setCurrentStatus(nextStatus);
      setSuccessMessage(
        action === "publish" ? "任务模板已发布。" : "任务模板已归档。",
      );
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summary = getLifecycleActionErrorSummary(action, error.status);
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          title: action === "publish" ? "发布任务模板失败" : "归档任务模板失败",
          description: buildErrorDescription(summary, detail),
        });
      } else {
        setErrorState({
          title: action === "publish" ? "发布任务模板失败" : "归档任务模板失败",
          description:
            action === "publish"
              ? "发布任务模板失败，请稍后重试。"
              : "归档任务模板失败，请稍后重试。",
        });
      }
    } finally {
      if (action === "publish") {
        setIsPublishing(false);
      } else {
        setIsArchiving(false);
      }
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">
        {effectiveReadOnly ? "查看任务模板" : "编辑任务模板"}
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        修改模板不会更新已布置到班级的任务标准。
      </p>
      {readOnly ? (
        <p className="mt-2 text-xs text-zinc-600">
          当前仅有查看权限，不能编辑或发布该模板。
        </p>
      ) : null}
      {publisherLabel ? (
        <p className="mt-2 inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
          {publisherLabel}
        </p>
      ) : null}
      {isArchived && !readOnly ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          当前任务模板已归档，不能直接编辑。后续如需复用，可复制为新草稿。
        </p>
      ) : null}
      {!readOnly && !hasKnownInitialStatus ? (
        <p className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          当前任务模板状态暂不可用，暂不允许编辑。
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <fieldset
          disabled={isSubmitting || isActionPending}
          className="min-w-0 space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">标题</span>
              <input
                disabled={effectiveReadOnly}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="请输入任务模板标题"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">知识模块</span>
              <input
                disabled={effectiveReadOnly}
                value={knowledgeModule}
                onChange={(event) => setKnowledgeModule(event.target.value)}
                placeholder="例如：GENERAL"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">课程分类</span>
              <select
                disabled={effectiveReadOnly}
                value={courseLabel}
                onChange={(event) => setCourseLabel(event.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                <option value="">未分类（通用模板）</option>
                {TASK_COURSE_LABEL_FORM_OPTIONS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                可选字段，仅用于模板治理（筛选/分组/检索辅助），不绑定课程。
              </p>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">模板可见性</span>
              <select
                disabled={effectiveReadOnly}
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as TaskTemplateVisibility)
                }
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                {TASK_TEMPLATE_VISIBILITIES.map((item) => (
                  <option key={item} value={item}>
                    {TASK_TEMPLATE_VISIBILITY_LABELS[item]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                共享后其他教师可查看，但不能编辑或发布该模板。
              </p>
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">任务难度（可选）</span>
            {effectiveReadOnly ? (
              <div className="whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
                {getDifficultyLabel(difficulty)}
              </div>
            ) : (
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              >
                <option value="">未设置</option>
                {TASK_DIFFICULTY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-xs text-zinc-500">{TASK_DIFFICULTY_HELP}</p>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">描述</span>
            <textarea
              readOnly={effectiveReadOnly}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={10}
              placeholder={`建议按以下内容编写，让学生清楚“做什么、怎样核验、提交什么”：

1. 学习目标：本题练习哪些知识？完成后，学生应能独立解释或完成什么？

2. 任务要求：说明要实现的功能、输入输出、边界条件和必要限制。可提供简短示例，并区分必做内容与选做拓展。

3. AI 使用约定：说明学生是否可以使用 AI，以及允许用于哪些环节，例如分析需求、讨论思路、解释代码、辅助排错或生成候选代码。使用 AI 后，学生仍需理解、检查并验证最终作品。

4. 核验要求：明确需要检查的典型情况和边界情况，要求学生先写预期，再在自己的环境中运行，记录关键实际结果。未运行的内容应如实说明，不能把 AI 的预测当作运行结果。

5. 提交内容：说明需要提交的完整源码、关键核验结果和简短思路解释。若使用 AI，要求简述它参与了什么、哪些建议被采用或调整，以及本人做了哪些核对；通常不需要完整聊天记录。

6. 修订要求：说明收到反馈后怎样判断问题、修改作品并复查。若发生修订，记录主要问题、修改依据和复查结果；首次正确或有依据地不采用建议，不必为了凑次数而修改。`}
              className="w-full resize-y overflow-auto rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <div>
            <div className="block text-sm">
              <span className="mb-1 block text-zinc-700">当前状态</span>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
                {getTaskTemplateStatusLabel(
                  hasKnownInitialStatus ? currentStatus : initialTask.status,
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                普通保存只更新内容；修改状态请使用下方按钮。
              </p>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">评阅标准（可选）</span>
            <textarea
              readOnly={effectiveReadOnly}
              value={rubricNotes}
              onChange={(event) => setRubricNotes(event.target.value)}
              rows={10}
              placeholder={`建议与任务描述逐项对应，写清“看什么、凭什么判断、怎样帮助学生改进”：

1. 功能与边界：根据哪些行为判断任务完成？重点检查哪些正常情况、边界情况和常见错误？接受哪些合理的等价实现？

2. 知识与理解：学生应能解释哪些关键设计、变量变化、调用过程或结果？结合本人代码和具体例子判断，不能只看程序是否给出了正确输出。

3. 核验质量：检查预期是否依据题意、实际结果是否对应提交版本，以及异常结果是否得到解释。区分源码可见事实、学生自报运行结果和仍需确认的内容；平台文本评阅不等于实际编译运行。

4. AI 协作（如使用）：关注学生是否理解候选方案，能否说明采用、调整或不采用建议的依据，并完成必要核验。不以模型品牌、聊天轮数或使用 AI 本身评价学习质量。

5. 修订效果（如发生）：关注学生是否找准问题、作出有依据的修改，并复查相关情况；不要只统计修改次数，也不要要求首次正确的学生制造修改过程。

6. 反馈要求：指出具体问题、依据、原因、修改方向和复查方法，让学生知道下一步怎样改。材料不足时明确需要补充什么；没有实质问题时不强行提出建议，不直接用完整答案替代学生完成任务。

评阅标准应与任务描述保持一致，并在学生开始任务前明确公开；评阅时不临时增加未告知学生的要求。`}
              className="w-full resize-y overflow-auto rounded-md border border-zinc-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-zinc-500">
              说明需要检查的内容、达成条件和重点。AI
              将据此给出评价依据与必要的改进建议，不自动计算成绩。留空时，依据任务描述评阅。
            </p>
          </label>
        </fieldset>

        {effectiveReadOnly ? (
          <TaskAiContextRefsReadOnly refs={aiContextBaseline} />
        ) : showAiContextEditor ? (
          <TaskAiContextRefsEditor
            value={aiContextText}
            onChange={setAiContextText}
            error={aiContextError}
            onError={setAiContextError}
            disabled={isSubmitting || isActionPending}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {!effectiveReadOnly ? (
            <button
              type="submit"
              disabled={isSubmitting || isActionPending}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {isSubmitting ? "保存中..." : "保存修改"}
            </button>
          ) : null}
          {canPublish ? (
            <button
              type="button"
              onClick={() => void handleLifecycleAction("publish")}
              disabled={isSubmitting || isActionPending}
              className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPublishing ? "发布中..." : "发布模板"}
            </button>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              onClick={() => void handleLifecycleAction("archive")}
              disabled={isSubmitting || isActionPending}
              className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 enabled:hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isArchiving ? "归档中..." : "归档模板"}
            </button>
          ) : null}
          <Link
            href={taskListReturnTo}
            className="text-sm text-blue-700 hover:underline"
          >
            返回任务模板列表
          </Link>
        </div>
      </form>

      {successMessage ? (
        <p className="mt-3 text-sm text-emerald-700">{successMessage}</p>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title={errorState.title ?? "更新任务模板失败"}
            description={errorState.description}
          />
        </div>
      ) : null}
    </section>
  );
}
