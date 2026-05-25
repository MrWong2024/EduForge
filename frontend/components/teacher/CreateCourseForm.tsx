"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  type CreateCourseRequest,
  toCourseCreateResponse,
} from "@/lib/api/types-teacher";
import {
  normalizeTaskCourseLabel,
  TASK_COURSE_LABEL_FORM_OPTIONS,
} from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";

type CreateCourseFormErrorState = {
  status?: number;
  description: string;
};

const getTermPlaceholder = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  if (month === 1) {
    return `例如 ${year - 1} 秋`;
  }

  if (month >= 2 && month <= 7) {
    return `例如 ${year} 春`;
  }

  return `例如 ${year} 秋`;
};

const getCreateErrorSummary = (status: number): string => {
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
    return "操作失败，请稍后重试。";
  }
  return "操作失败，请稍后重试。";
};

export function CreateCourseForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [courseLabel, setCourseLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<CreateCourseFormErrorState | null>(null);
  const termPlaceholder = getTermPlaceholder();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const trimmedTerm = term.trim();
    const normalizedCourseLabel = normalizeTaskCourseLabel(courseLabel);

    if (!trimmedCode || !trimmedName || !trimmedTerm) {
      setErrorState({
        description: "请填写课程代码、课程名称和学期。",
      });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const requestBody: CreateCourseRequest = {
      code: trimmedCode,
      name: trimmedName,
      term: trimmedTerm,
    };
    if (normalizedCourseLabel) {
      requestBody.courseLabel = normalizedCourseLabel;
    }

    try {
      const payload = await fetchJson<unknown>("courses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const response = toCourseCreateResponse(payload);
      if (response.id) {
        router.push(paths.teacher.courseOverview(response.id));
        return;
      }

      setSuccessMessage("课程已创建。");
      router.push(paths.teacher.courses);
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
          description: "操作失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="create-course-form" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">创建课程</h2>
      <p className="mt-1 text-sm text-zinc-600">
        填写最小信息后创建课程，成功后将自动进入课程总览。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">课程代码</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="例如 CS101"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">课程名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 程序设计基础"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">学期</span>
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={termPlaceholder}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">课程分类</span>
          <select
            value={courseLabel}
            onChange={(event) => setCourseLabel(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            <option value="">未分类（可不选）</option>
            {TASK_COURSE_LABEL_FORM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="md:col-span-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {isSubmitting ? "创建中..." : "创建课程"}
          </button>
        </div>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="创建课程失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
