"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import {
  buildErrorDescription,
  extractRawDetail,
} from "@/lib/api/error-presenter";
import {
  toLearningTaskCreateResponse,
  type CreateLearningTaskRequest,
} from "@/lib/api/types-teacher";
import {
  TASK_COURSE_LABEL_FORM_OPTIONS,
  normalizeTaskCourseLabel,
} from "@/lib/learning-tasks/course-labels";
import {
  TASK_DIFFICULTY_HELP,
  TASK_DIFFICULTY_OPTIONS,
  createDifficultyPayload,
} from "@/lib/learning-tasks/difficulty";
import {
  TASK_TEMPLATE_VISIBILITIES,
  TASK_TEMPLATE_VISIBILITY_LABELS,
  TASK_TEMPLATE_VISIBILITY_PRIVATE,
  type TaskTemplateVisibility,
} from "@/lib/learning-tasks/template-visibility-scope";
import { buildCreateTaskRubric } from "@/lib/learning-tasks/rubric";

type CreateLearningTaskFormErrorState = {
  status?: number;
  description: string;
};

type CreateAction = "draft" | "publish";

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

export function CreateLearningTaskForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [knowledgeModule, setKnowledgeModule] = useState("");
  const [courseLabel, setCourseLabel] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [visibility, setVisibility] = useState<TaskTemplateVisibility>(
    TASK_TEMPLATE_VISIBILITY_PRIVATE,
  );
  const [rubricNotes, setRubricNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<CreateAction | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] =
    useState<CreateLearningTaskFormErrorState | null>(null);

  const isSubmitting = pendingAction !== null;

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setKnowledgeModule("");
    setCourseLabel("");
    setDifficulty("");
    setVisibility(TASK_TEMPLATE_VISIBILITY_PRIVATE);
    setRubricNotes("");
  };

  const submitCreate = async (
    event: React.FormEvent<HTMLFormElement>,
    action: CreateAction,
  ) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedKnowledgeModule = knowledgeModule.trim();
    const normalizedCourseLabel = normalizeTaskCourseLabel(courseLabel);
    const rubric = buildCreateTaskRubric(rubricNotes);

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
    setPendingAction(action);
    setSuccessMessage(null);
    setErrorState(null);

    const requestBody: CreateLearningTaskRequest = {
      title: trimmedTitle,
      description: trimmedDescription,
      knowledgeModule: trimmedKnowledgeModule,
      visibility,
      status: action === "publish" ? "PUBLISHED" : "DRAFT",
      ...createDifficultyPayload(difficulty),
    };
    if (normalizedCourseLabel) {
      requestBody.courseLabel = normalizedCourseLabel;
    }
    if (rubric) {
      requestBody.rubric = rubric;
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
      if (!created.id) {
        throw new Error("创建结果无法确认");
      }
      const actionMessage =
        action === "publish" ? "任务模板已发布" : "任务模板已保存为草稿";
      const rubricMessage = rubric ? "评阅标准已保存。" : "";
      setSuccessMessage(
        `${actionMessage}。${rubricMessage ? ` ${rubricMessage}` : ""}`,
      );
      resetForm();
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
      setPendingAction(null);
    }
  };

  const handleSaveDraft = (event: React.FormEvent<HTMLFormElement>) =>
    submitCreate(event, "draft");

  const handlePublishTemplate = async () => {
    const syntheticEvent = {
      preventDefault() {},
    } as React.FormEvent<HTMLFormElement>;
    await submitCreate(syntheticEvent, "publish");
  };

  return (
    <section
      id="create-learning-task-form"
      className="rounded-lg border border-zinc-200 bg-white p-4"
    >
      <h2 className="text-base font-semibold text-zinc-900">创建任务模板</h2>
      <p className="mt-1 text-sm text-zinc-600">
        这里创建的是可复用模板；创建完成后，请到班级任务页将模板发布到具体班级。
      </p>

      <form onSubmit={handleSaveDraft} className="mt-4 space-y-4">
        <fieldset disabled={isSubmitting} className="min-w-0 space-y-4">
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
            <span className="mb-1 block text-zinc-700">任务难度（可选）</span>
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
            <p className="mt-1 text-xs text-zinc-500">{TASK_DIFFICULTY_HELP}</p>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">描述</span>
            <textarea
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
              <span className="mb-1 block text-zinc-700">创建动作</span>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
                使用下方按钮决定初始状态：可保存为草稿或直接发布模板。
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                已发布模板可在编辑页归档。
              </p>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">评阅标准（可选）</span>
            <textarea
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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {pendingAction === "draft" ? "保存中..." : "保存为草稿"}
          </button>
          <button
            type="button"
            onClick={handlePublishTemplate}
            disabled={isSubmitting}
            className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === "publish" ? "发布中..." : "发布模板"}
          </button>
        </div>
      </form>

      {successMessage ? (
        <p className="mt-3 text-sm text-emerald-700">{successMessage}</p>
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState
            status={errorState.status}
            title="创建任务模板失败"
            description={errorState.description}
          />
        </div>
      ) : null}
    </section>
  );
}
