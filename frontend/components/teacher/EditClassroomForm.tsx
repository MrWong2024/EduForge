"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  type ClassroomDetailResponse,
  toClassroomUpdateResponse,
  type UpdateClassroomRequest,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { toDisplayText } from "@/lib/ui/format";

type EditClassroomFormProps = {
  classroomId: string;
  initialClassroom: ClassroomDetailResponse;
};

type EditClassroomFormErrorState = {
  status?: number;
  title: string;
  description: string;
};

type ClassroomCourseDisplay = {
  title: string;
  details: string[];
  showCourseIdFallback: boolean;
};

const getUpdateErrorSummary = (status: number, detail?: string): string => {
  if (status === 400) {
    if (detail?.includes("Archived classrooms cannot be updated")) {
      return "班级已归档，不允许编辑班级基础信息。";
    }
    return "更新参数不合法，或当前班级状态不允许更新。";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "无权限编辑该班级。";
  }
  if (status === 404) {
    return "班级不存在或功能未启用/不可用。";
  }
  if (status >= 500) {
    return "更新班级失败，请稍后重试。";
  }
  return "更新班级失败，请稍后重试。";
};

const getClassroomCourseDisplay = (
  classroom: ClassroomDetailResponse,
): ClassroomCourseDisplay => {
  const course = classroom.course;
  const title =
    course?.name?.trim() ||
    course?.code?.trim() ||
    course?.courseLabel?.trim() ||
    "课程信息暂不可用";
  const details: string[] = [];

  if (course?.code && course.code !== title) {
    details.push(`课程编号：${course.code}`);
  }
  if (course?.term) {
    details.push(`学期：${course.term}`);
  }
  if (course?.courseLabel && course.courseLabel !== title) {
    details.push(`标签：${course.courseLabel}`);
  }

  return {
    title,
    details,
    showCourseIdFallback: title === "课程信息暂不可用",
  };
};

export function EditClassroomForm({ classroomId, initialClassroom }: EditClassroomFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialClassroom.name ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<EditClassroomFormErrorState | null>(null);
  const courseDisplay = getClassroomCourseDisplay(initialClassroom);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setErrorState({
        title: "更新班级失败",
        description: "请填写班级名称。",
      });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    const requestBody: UpdateClassroomRequest = {
      name: trimmedName,
    };

    try {
      const payload = await fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const response = toClassroomUpdateResponse(payload);
      const nextClassroomId = response.id?.trim() || classroomId;
      setSuccessMessage("班级更新成功。");
      router.push(paths.teacher.classroomDashboard(nextClassroomId));
      router.refresh();
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        setErrorState({
          status: error.status,
          title: "更新班级失败",
          description: buildErrorDescription(getUpdateErrorSummary(error.status, detail), detail),
        });
      } else {
        setErrorState({
          title: "更新班级失败",
          description: "更新班级失败，请稍后重试。",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">编辑班级</h2>
      <p className="mt-1 text-sm text-zinc-600">
        本页只修改班级基础信息。当前后端仅允许更新班级名称，所属课程与状态为只读展示。
      </p>

      <div className="mt-4 grid gap-2 text-sm text-zinc-600 md:grid-cols-3">
        <div>
          <p>所属课程：{courseDisplay.title}</p>
          {courseDisplay.details.length > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">{courseDisplay.details.join(" · ")}</p>
          ) : null}
          {courseDisplay.showCourseIdFallback ? (
            <p className="mt-1 text-xs text-zinc-400">课程 ID：{toDisplayText(initialClassroom.courseId)}</p>
          ) : null}
        </div>
        <p>当前状态：{toDisplayText(initialClassroom.status)}</p>
        <p>加入码：{toDisplayText(initialClassroom.joinCode)}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-700">班级名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 2026 春-1 班"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {isSubmitting ? "保存中..." : "保存修改"}
          </button>
          <Link href={paths.teacher.classrooms} className="text-sm text-blue-700 hover:underline">
            返回班级列表
          </Link>
          <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回班级看板
          </Link>
        </div>
      </form>

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title={errorState.title} description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
