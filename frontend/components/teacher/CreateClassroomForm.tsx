"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  type CourseSummary,
  type CreateClassroomRequest,
  toClassroomCreateResponse,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";

type CreateClassroomFormProps = {
  courses: CourseSummary[];
  initialCourseId?: string;
};

type CreateClassroomFormErrorState = {
  status?: number;
  description: string;
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

export function CreateClassroomForm({ courses, initialCourseId }: CreateClassroomFormProps) {
  const router = useRouter();
  const availableCourses = useMemo(() => courses.filter((course) => Boolean(course.id)), [courses]);
  const defaultCourseId = useMemo(() => {
    if (initialCourseId && availableCourses.some((course) => course.id === initialCourseId)) {
      return initialCourseId;
    }
    return availableCourses[0]?.id ?? "";
  }, [availableCourses, initialCourseId]);

  const [courseId, setCourseId] = useState(defaultCourseId);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<CreateClassroomFormErrorState | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCourseId = courseId.trim();

    if (!trimmedCourseId) {
      setErrorState({
        description: "请先选择课程。",
      });
      return;
    }
    if (!trimmedName) {
      setErrorState({
        description: "请填写班级名称。",
      });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const requestBody: CreateClassroomRequest = {
      courseId: trimmedCourseId,
      name: trimmedName,
    };

    try {
      const payload = await fetchJson<unknown>("classrooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const response = toClassroomCreateResponse(payload);
      if (response.id) {
        router.push(paths.teacher.classroomDashboard(response.id));
        return;
      }

      setSuccessMessage("班级已创建。");
      router.push(paths.teacher.classrooms);
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
    <section id="create-classroom-form" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">创建班级</h2>
      <p className="mt-1 text-sm text-zinc-600">
        先选择课程再创建班级，成功后将自动进入班级看板。
      </p>

      {availableCourses.length === 0 ? (
        <p className="mt-3 text-sm text-amber-700">当前暂无可选课程，请先在课程页创建课程。</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">所属课程</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            >
              {availableCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {(course.code ?? "未命名课程") + " - " + (course.name ?? "未命名课程")}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">班级名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 2026 春-1 班"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {isSubmitting ? "创建中..." : "创建班级"}
            </button>
          </div>
        </form>
      )}

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="创建班级失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
