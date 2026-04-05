"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  LEARNING_TASK_STATUSES,
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
  TASK_TEMPLATE_VISIBILITIES,
  TASK_TEMPLATE_VISIBILITY_LABELS,
  TASK_TEMPLATE_VISIBILITY_SHARED,
  normalizeTaskTemplateVisibility,
  type TaskTemplateVisibility,
} from "@/lib/learning-tasks/template-visibility-scope";
import { paths } from "@/lib/routes/paths";
import { getRubricDimensionLabel } from "@/lib/ui/rubric";

type EditLearningTaskFormProps = {
  taskId: string;
  initialTask: LearningTaskDetailResponse;
  readOnly?: boolean;
  returnTo?: string;
};

type EditLearningTaskFormErrorState = {
  status?: number;
  description: string;
};

type RubricFormSeed = {
  functionalityWeight: string;
  correctnessWeight: string;
  codeStyleWeight: string;
  designWeight: string;
  notes: string;
  legacyUnstructured: boolean;
  sourceRubric?: Record<string, unknown>;
};

const statusLabelMap: Record<LearningTaskStatus, string> = {
  DRAFT: "DRAFT（草稿）",
  PUBLISHED: "PUBLISHED（已发布）",
  ARCHIVED: "ARCHIVED（已归档）",
};

const isLearningTaskStatus = (value: string): value is LearningTaskStatus =>
  LEARNING_TASK_STATUSES.some((status) => status === value);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const toStatusInitial = (value: unknown): LearningTaskStatus => {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "";
  return isLearningTaskStatus(candidate) ? candidate : "DRAFT";
};

const parseStage = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
    return null;
  }
  return parsed;
};

const parseOptionalNonNegativeInt = (value: string): number | undefined | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const pickNonNegativeInt = (...candidates: unknown[]): number | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) {
      return candidate;
    }
  }
  return undefined;
};

const functionalityLabel = getRubricDimensionLabel("functionality");
const correctnessLabel = getRubricDimensionLabel("correctness");
const codeStyleLabel = getRubricDimensionLabel("codeStyle");
const designLabel = getRubricDimensionLabel("design");

const extractRubricFormSeed = (rubric: Record<string, unknown> | undefined): RubricFormSeed => {
  if (!rubric || Object.keys(rubric).length === 0) {
    return {
      functionalityWeight: "",
      correctnessWeight: "",
      codeStyleWeight: "",
      designWeight: "",
      notes: "",
      legacyUnstructured: false,
    };
  }

  const dimensions = asRecord(rubric.dimensions);
  const functionality = pickNonNegativeInt(
    dimensions?.functionality,
    rubric.functionality,
    rubric.functionalityWeight
  );
  const correctness = pickNonNegativeInt(
    dimensions?.correctness,
    rubric.correctness,
    rubric.correctnessWeight
  );
  const codeStyle = pickNonNegativeInt(
    dimensions?.codeStyle,
    rubric.codeStyle,
    rubric.codeStyleWeight
  );
  const design = pickNonNegativeInt(
    dimensions?.design,
    rubric.design,
    rubric.designWeight
  );
  const notes = typeof rubric.notes === "string" ? rubric.notes.trim() : "";
  const recognizedCount =
    [functionality, correctness, codeStyle, design].filter((value) => typeof value === "number")
      .length + (notes ? 1 : 0);

  return {
    functionalityWeight: typeof functionality === "number" ? String(functionality) : "",
    correctnessWeight: typeof correctness === "number" ? String(correctness) : "",
    codeStyleWeight: typeof codeStyle === "number" ? String(codeStyle) : "",
    designWeight: typeof design === "number" ? String(design) : "",
    notes,
    legacyUnstructured: Object.keys(rubric).length > 0 && recognizedCount === 0,
    sourceRubric: rubric,
  };
};

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

const toSafeTaskListReturnTo = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return paths.teacher.tasks;
  }
  if (trimmed.startsWith("//")) {
    return paths.teacher.tasks;
  }
  if (!/^\/teacher\/tasks(?:[/?#]|$)/.test(trimmed)) {
    return paths.teacher.tasks;
  }
  return trimmed;
};

export function EditLearningTaskForm({
  taskId,
  initialTask,
  readOnly = false,
  returnTo,
}: EditLearningTaskFormProps) {
  const router = useRouter();
  const taskListReturnTo = toSafeTaskListReturnTo(returnTo);
  const rubricSeed = extractRubricFormSeed(initialTask.rubric);
  const initialCourseLabel = normalizeTaskCourseLabel(initialTask.courseLabel);
  const initialVisibility =
    normalizeTaskTemplateVisibility(initialTask.visibility) ??
    TASK_TEMPLATE_VISIBILITY_SHARED;
  const [title, setTitle] = useState(initialTask.title ?? "");
  const [description, setDescription] = useState(initialTask.description ?? "");
  const [knowledgeModule, setKnowledgeModule] = useState(initialTask.knowledgeModule ?? "");
  const [courseLabel, setCourseLabel] = useState(
    initialCourseLabel && initialCourseLabel !== TASK_COURSE_LABEL_UNCLASSIFIED
      ? initialCourseLabel
      : ""
  );
  const [stage, setStage] = useState(
    typeof initialTask.stage === "number" && Number.isInteger(initialTask.stage)
      ? String(initialTask.stage)
      : "1"
  );
  const [status, setStatus] = useState<LearningTaskStatus>(
    toStatusInitial(initialTask.status)
  );
  const [visibility, setVisibility] =
    useState<TaskTemplateVisibility>(initialVisibility);
  const [functionalityWeight, setFunctionalityWeight] = useState(
    rubricSeed.functionalityWeight
  );
  const [correctnessWeight, setCorrectnessWeight] = useState(
    rubricSeed.correctnessWeight
  );
  const [codeStyleWeight, setCodeStyleWeight] = useState(rubricSeed.codeStyleWeight);
  const [designWeight, setDesignWeight] = useState(rubricSeed.designWeight);
  const [rubricNotes, setRubricNotes] = useState(rubricSeed.notes);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<EditLearningTaskFormErrorState | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedKnowledgeModule = knowledgeModule.trim();
    const normalizedCourseLabel = normalizeTaskCourseLabel(courseLabel);
    const trimmedRubricNotes = rubricNotes.trim();
    const parsedStage = parseStage(stage);
    const parsedFunctionalityWeight = parseOptionalNonNegativeInt(functionalityWeight);
    const parsedCorrectnessWeight = parseOptionalNonNegativeInt(correctnessWeight);
    const parsedCodeStyleWeight = parseOptionalNonNegativeInt(codeStyleWeight);
    const parsedDesignWeight = parseOptionalNonNegativeInt(designWeight);

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
    if (parsedStage === null) {
      setErrorState({
        description: "阶段必须是 1~4 的整数。",
      });
      return;
    }
    if (!isLearningTaskStatus(status)) {
      setErrorState({
        description: "任务模板状态不合法，请重新选择。",
      });
      return;
    }
    if (parsedFunctionalityWeight === null) {
      setErrorState({
        description: `${functionalityLabel}必须是非负整数。`,
      });
      return;
    }
    if (parsedCorrectnessWeight === null) {
      setErrorState({
        description: `${correctnessLabel}必须是非负整数。`,
      });
      return;
    }
    if (parsedCodeStyleWeight === null) {
      setErrorState({
        description: `${codeStyleLabel}必须是非负整数。`,
      });
      return;
    }
    if (parsedDesignWeight === null) {
      setErrorState({
        description: `${designLabel}必须是非负整数。`,
      });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const rubricDimensions: Record<string, number> = {};
    if (typeof parsedFunctionalityWeight === "number") {
      rubricDimensions.functionality = parsedFunctionalityWeight;
    }
    if (typeof parsedCorrectnessWeight === "number") {
      rubricDimensions.correctness = parsedCorrectnessWeight;
    }
    if (typeof parsedCodeStyleWeight === "number") {
      rubricDimensions.codeStyle = parsedCodeStyleWeight;
    }
    if (typeof parsedDesignWeight === "number") {
      rubricDimensions.design = parsedDesignWeight;
    }
    const hasRubricDimensions = Object.keys(rubricDimensions).length > 0;
    const hasRubricInput = hasRubricDimensions || Boolean(trimmedRubricNotes);
    const shouldPreserveLegacyRubric =
      !hasRubricInput && rubricSeed.legacyUnstructured && Boolean(rubricSeed.sourceRubric);

    const requestBody: UpdateLearningTaskRequest = {
      title: trimmedTitle,
      description: trimmedDescription,
      knowledgeModule: trimmedKnowledgeModule,
      courseLabel: normalizedCourseLabel ?? "",
      visibility,
      stage: parsedStage,
      status,
    };
    if (hasRubricInput) {
      const rubricPayload: Record<string, unknown> = {};
      if (hasRubricDimensions) {
        rubricPayload.dimensions = rubricDimensions;
      }
      if (trimmedRubricNotes) {
        rubricPayload.notes = trimmedRubricNotes;
      }
      requestBody.rubric = rubricPayload;
    } else if (shouldPreserveLegacyRubric) {
      requestBody.rubric = rubricSeed.sourceRubric;
    }

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
        }
      );

      const updated = toLearningTaskUpdateResponse(payload);
      const updatedTaskId = updated.id?.trim();
      const suffix = hasRubricInput ? "，评分配置已更新。" : "。";
      setSuccessMessage(
        updatedTaskId ? `任务模板更新成功（ID: ${updatedTaskId}）${suffix}` : `任务模板更新成功${suffix}`
      );
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summary = getUpdateErrorSummary(error.status);
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          description: buildErrorDescription(summary, detail),
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

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">
        {readOnly ? "查看任务模板" : "编辑任务模板"}
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        修改的是 learning task 模板本身，不是班级任务实例。
      </p>
      {readOnly ? (
        <p className="mt-2 text-xs text-zinc-600">
          当前模板由其他教师创建，你可以查看内容，但不能编辑或发布该模板。
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <fieldset disabled={isSubmitting || readOnly} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">标题</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="请输入任务模板标题"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">知识模块</span>
            <input
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
          <span className="mb-1 block text-zinc-700">描述</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="请输入任务模板描述"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">阶段</span>
            <input
              type="number"
              min={1}
              max={4}
              step={1}
              inputMode="numeric"
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">状态</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as LearningTaskStatus)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {LEARNING_TASK_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {statusLabelMap[item]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              PUBLISHED 可用于班级发布；DRAFT / ARCHIVED 通常不会出现在班级发布可选列表。
            </p>
          </label>
        </div>

        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <h3 className="text-sm font-medium text-zinc-900">基础评分配置（Rubric）</h3>
          <p className="mt-1 text-xs text-zinc-600">
            使用结构化字段维护评分参考；无需手写 JSON。
          </p>
          {rubricSeed.legacyUnstructured ? (
            <p className="mt-1 text-xs text-amber-700">
              检测到历史 rubric 结构，当前表单无法完整回填。若不填写新字段，保存时将保留历史结构。
            </p>
          ) : null}

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">{`${functionalityLabel}（可选）`}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={functionalityWeight}
                onChange={(event) => setFunctionalityWeight(event.target.value)}
                placeholder="例如 40"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">{`${correctnessLabel}（可选）`}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={correctnessWeight}
                onChange={(event) => setCorrectnessWeight(event.target.value)}
                placeholder="例如 30"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">{`${codeStyleLabel}（可选）`}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={codeStyleWeight}
                onChange={(event) => setCodeStyleWeight(event.target.value)}
                placeholder="例如 20"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">{`${designLabel}（可选）`}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={designWeight}
                onChange={(event) => setDesignWeight(event.target.value)}
                placeholder="例如 10"
                className="w-full rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-zinc-700">评分说明（可选）</span>
            <textarea
              value={rubricNotes}
              onChange={(event) => setRubricNotes(event.target.value)}
              rows={3}
              placeholder="例如：优先关注可运行性与命名规范"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          {!readOnly ? (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {isSubmitting ? "保存中..." : "保存修改"}
            </button>
          ) : null}
          <Link href={taskListReturnTo} className="text-sm text-blue-700 hover:underline">
            返回任务模板列表
          </Link>
        </div>
        </fieldset>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="更新任务模板失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
