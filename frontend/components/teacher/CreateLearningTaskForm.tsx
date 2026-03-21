"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  LEARNING_TASK_STATUSES,
  toLearningTaskCreateResponse,
  type CreateLearningTaskRequest,
  type LearningTaskStatus,
} from "@/lib/api/types-teacher";

type CreateLearningTaskFormErrorState = {
  status?: number;
  description: string;
};

const statusLabelMap: Record<LearningTaskStatus, string> = {
  DRAFT: "DRAFT（草稿）",
  PUBLISHED: "PUBLISHED（已发布）",
  ARCHIVED: "ARCHIVED（已归档）",
};

const isLearningTaskStatus = (value: string): value is LearningTaskStatus =>
  LEARNING_TASK_STATUSES.some((status) => status === value);

const getCreateErrorSummary = (status: number): string => {
  if (status === 400) {
    return "提交参数不合法，请检查后重试。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限执行该操作。";
  }
  if (status === 404) {
    return "功能未启用、不可用或资源不存在。";
  }
  if (status >= 500) {
    return "创建任务模板失败，请稍后重试。";
  }
  return "创建任务模板失败，请稍后重试。";
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

export function CreateLearningTaskForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [knowledgeModule, setKnowledgeModule] = useState("");
  const [stage, setStage] = useState("1");
  const [status, setStatus] = useState<LearningTaskStatus>("DRAFT");
  const [functionalityWeight, setFunctionalityWeight] = useState("");
  const [correctnessWeight, setCorrectnessWeight] = useState("");
  const [codeStyleWeight, setCodeStyleWeight] = useState("");
  const [designWeight, setDesignWeight] = useState("");
  const [rubricNotes, setRubricNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<CreateLearningTaskFormErrorState | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedKnowledgeModule = knowledgeModule.trim();
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
        description: "功能完成度权重必须是非负整数。",
      });
      return;
    }
    if (parsedCorrectnessWeight === null) {
      setErrorState({
        description: "正确性权重必须是非负整数。",
      });
      return;
    }
    if (parsedCodeStyleWeight === null) {
      setErrorState({
        description: "代码规范权重必须是非负整数。",
      });
      return;
    }
    if (parsedDesignWeight === null) {
      setErrorState({
        description: "设计/思路权重必须是非负整数。",
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
    const hasRubric = hasRubricDimensions || Boolean(trimmedRubricNotes);

    const requestBody: CreateLearningTaskRequest = {
      title: trimmedTitle,
      description: trimmedDescription,
      knowledgeModule: trimmedKnowledgeModule,
      stage: parsedStage,
      status,
    };
    if (hasRubric) {
      const rubricPayload: Record<string, unknown> = {};
      if (hasRubricDimensions) {
        rubricPayload.dimensions = rubricDimensions;
      }
      if (trimmedRubricNotes) {
        rubricPayload.notes = trimmedRubricNotes;
      }
      requestBody.rubric = rubricPayload;
    }

    try {
      const payload = await fetchJson<unknown>("learning-tasks/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const created = toLearningTaskCreateResponse(payload);
      const createdTaskId = created.id?.trim();
      setSuccessMessage(
        createdTaskId
          ? `任务模板创建成功（ID: ${createdTaskId}）${hasRubric ? "，评分配置已保存。" : "。"}`
          : hasRubric
            ? "任务模板创建成功，评分配置已保存。"
            : "任务模板创建成功。"
      );
      setTitle("");
      setDescription("");
      setKnowledgeModule("");
      setStage("1");
      setStatus("DRAFT");
      setFunctionalityWeight("");
      setCorrectnessWeight("");
      setCodeStyleWeight("");
      setDesignWeight("");
      setRubricNotes("");
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const summary = getCreateErrorSummary(error.status);
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          description: buildErrorDescription(summary, detail),
        });
      } else {
        setErrorState({
          description: "创建任务模板失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="create-learning-task-form" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">创建任务模板</h2>
      <p className="mt-1 text-sm text-zinc-600">
        这里创建的是可复用模板；创建完成后，请到班级任务页将模板发布到具体班级。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
          </label>
        </div>

        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <h3 className="text-sm font-medium text-zinc-900">基础评分配置（Rubric）</h3>
          <p className="mt-1 text-xs text-zinc-600">
            可选填写。若全部留空，本次创建不会提交 rubric 字段。
          </p>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-700">功能完成度权重（可选）</span>
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
              <span className="mb-1 block text-zinc-700">正确性权重（可选）</span>
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
              <span className="mb-1 block text-zinc-700">代码规范权重（可选）</span>
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
              <span className="mb-1 block text-zinc-700">设计/思路权重（可选）</span>
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "创建中..." : "创建任务模板"}
        </button>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="创建任务模板失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
