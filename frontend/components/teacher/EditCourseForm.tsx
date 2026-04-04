"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  type CourseDetailResponse,
  toCourseUpdateResponse,
  type UpdateCourseRequest,
} from "@/lib/api/types-teacher";
import {
  normalizeTaskCourseLabel,
  TASK_COURSE_LABEL_FORM_OPTIONS,
  TASK_COURSE_LABEL_UNCLASSIFIED,
} from "@/lib/learning-tasks/course-labels";
import { paths } from "@/lib/routes/paths";

type EditCourseFormProps = {
  courseId: string;
  initialCourse: CourseDetailResponse;
};

type EditCourseFormErrorState = {
  status?: number;
  description: string;
};

const getUpdateErrorSummary = (status: number): string => {
  if (status === 400) {
    return "更新参数不合法，请检查后重试。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限编辑该课程。";
  }
  if (status === 404) {
    return "课程不存在或功能未启用/不可用。";
  }
  if (status >= 500) {
    return "更新课程失败，请稍后重试。";
  }
  return "更新课程失败，请稍后重试。";
};

export function EditCourseForm({ courseId, initialCourse }: EditCourseFormProps) {
  const router = useRouter();
  const [code, setCode] = useState(initialCourse.code ?? "");
  const [name, setName] = useState(initialCourse.name ?? "");
  const [term, setTerm] = useState(initialCourse.term ?? "");
  const [courseLabel, setCourseLabel] = useState(
    initialCourse.courseLabel && initialCourse.courseLabel !== TASK_COURSE_LABEL_UNCLASSIFIED
      ? initialCourse.courseLabel
      : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<EditCourseFormErrorState | null>(null);

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

    const requestBody: UpdateCourseRequest = {
      code: trimmedCode,
      name: trimmedName,
      term: trimmedTerm,
      courseLabel: normalizedCourseLabel ?? "",
    };

    try {
      const payload = await fetchJson<unknown>(`courses/${encodeURIComponent(courseId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const response = toCourseUpdateResponse(payload);
      const nextCourseId = response.id?.trim() || courseId;
      setSuccessMessage("课程更新成功。");
      router.push(paths.teacher.courseOverview(nextCourseId));
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
          description: "更新课程失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">编辑课程</h2>
      <p className="mt-1 text-sm text-zinc-600">
        可修改课程基础信息与课程分类；课程分类用于与任务模板分类坐标对齐。
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
            placeholder="例如 2026 春"
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

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {isSubmitting ? "保存中..." : "保存修改"}
          </button>
          <Link href={paths.teacher.courses} className="text-sm text-blue-700 hover:underline">
            返回课程列表
          </Link>
          <Link href={paths.teacher.courseOverview(courseId)} className="text-sm text-blue-700 hover:underline">
            返回课程总览
          </Link>
        </div>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="更新课程失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}

