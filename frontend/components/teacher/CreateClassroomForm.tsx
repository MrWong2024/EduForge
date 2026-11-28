"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/blocks/ErrorState";
import { CreateOutcomeReview } from "@/components/teacher/CreateOutcomeReview";
import { fetchJson, isDefiniteCreateRejection } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  type CreateClassroomRequest,
  toClassroomCreateResponse,
  toCourseListResponse,
} from "@/lib/api/types-teacher";
import {
  classroomCoursePagePath,
  mergeClassroomCourseOptions,
  nextClassroomCoursePage,
  type ClassroomCourseOption,
} from "@/lib/classroom-creation-courses";
import { paths } from "@/lib/routes/paths";

type CreateClassroomFormProps = {
  courses: ClassroomCourseOption[];
  initialCourseId?: string;
  targetUnavailable: boolean;
  nextPage?: number;
};

type CreateClassroomFormErrorState = {
  status?: number;
  description: string;
};

const getClassroomNamePlaceholder = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  if (month === 1) {
    return `例如 ${year - 1} 秋-1 班`;
  }

  if (month >= 2 && month <= 7) {
    return `例如 ${year} 春-1 班`;
  }

  return `例如 ${year} 秋-1 班`;
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
  return "操作失败，请稍后重试。";
};

export function CreateClassroomForm({
  courses,
  initialCourseId,
  targetUnavailable,
  nextPage,
}: CreateClassroomFormProps) {
  const router = useRouter();
  const [loadedCourses, setLoadedCourses] = useState(courses);
  const [loadedPage, setLoadedPage] = useState<{ nextPage?: number } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourseId);
  const [name, setName] = useState("");
  const submitLocked = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<CreateClassroomFormErrorState | null>(null);
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const isLocked = isSubmitting || isNavigating;
  const classroomNamePlaceholder = getClassroomNamePlaceholder();
  const availableCourses = useMemo(
    () => mergeClassroomCourseOptions(courses, loadedCourses),
    [courses, loadedCourses],
  );
  const courseId = selectedCourseId ?? initialCourseId ?? availableCourses[0]?.id ?? "";
  const nextPageToLoad = loadedPage ? loadedPage.nextPage : nextPage;

  useEffect(() => {
    if (successMessage && !isLocked) {
      submitLocked.current = false;
    }
  }, [isLocked, successMessage]);

  const handleLoadMore = async () => {
    if (targetUnavailable || isLoadingMore || nextPageToLoad === undefined) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const payload = await fetchJson<unknown>(classroomCoursePagePath(nextPageToLoad));
      const response = toCourseListResponse(payload);
      setLoadedCourses((current) => mergeClassroomCourseOptions(current, response.items));
      setLoadedPage({ nextPage: nextClassroomCoursePage(response, nextPageToLoad) });
    } catch {
      setLoadMoreError(true);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (targetUnavailable || submitLocked.current || isLocked || outcomeUncertain) {
      return;
    }
    const trimmedName = name.trim();

    if (!availableCourses.some((course) => course.id === courseId)) {
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

    const requestBody: CreateClassroomRequest = {
      courseId,
      name: trimmedName,
    };

    submitLocked.current = true;
    setSelectedCourseId(courseId);
    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorState(null);

    let classroomId: string | undefined;
    try {
      const payload = await fetchJson<unknown>("classrooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      classroomId = toClassroomCreateResponse(payload).id;
    } catch (error) {
      if (isDefiniteCreateRejection(error)) {
        const summary = getCreateErrorSummary(error.status);
        const detail = extractRawDetail(error);
        setErrorState({
          status: error.status,
          description: buildErrorDescription(summary, detail),
        });
        submitLocked.current = false;
      } else {
        setOutcomeUncertain(true);
      }
      setIsSubmitting(false);
      return;
    }

    startNavigation(() => {
      if (classroomId) {
        router.push(paths.teacher.classroomDashboard(classroomId));
      } else {
        router.push(paths.teacher.classrooms);
        router.refresh();
      }
      setName("");
      setSuccessMessage("班级已创建。");
      setIsSubmitting(false);
    });
  };

  return (
    <section id="create-classroom-form" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">创建班级</h2>
      <p className="mt-1 text-sm text-zinc-600">
        先选择课程再创建班级，成功后将自动进入班级看板。
      </p>

      {targetUnavailable ? (
        <p className="mt-3 text-sm text-amber-800">
          无法确认入口指定的课程。请
          <Link href={paths.teacher.classrooms} className="text-blue-700 underline">
            返回班级列表重新选择课程
          </Link>
          。
        </p>
      ) : availableCourses.length === 0 && nextPageToLoad === undefined ? (
        <p className="mt-3 text-sm text-amber-700">当前暂无可选课程，请先在课程页创建课程。</p>
      ) : availableCourses.length > 0 ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-700">所属课程</span>
            <select
              value={courseId}
              disabled={isLocked}
              onChange={(event) => setSelectedCourseId(event.target.value)}
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
              disabled={isLocked}
              onChange={(event) => setName(event.target.value)}
              placeholder={classroomNamePlaceholder}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isLocked || outcomeUncertain}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {isLocked ? "创建中..." : "创建班级"}
            </button>
          </div>
        </form>
      ) : null}

      {!targetUnavailable && nextPageToLoad !== undefined ? (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="mt-3 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isLoadingMore ? "正在加载课程…" : "加载更多课程"}
        </button>
      ) : null}
      {loadMoreError ? (
        <p role="status" className="mt-2 text-sm text-amber-800">加载更多课程失败，请重试。</p>
      ) : null}

      {successMessage ? <p className="mt-3 text-sm text-emerald-700">{successMessage}</p> : null}

      {outcomeUncertain ? (
        <CreateOutcomeReview
          listHref={paths.teacher.classrooms}
          listLabel="查看班级列表"
          onConfirm={() => {
            setOutcomeUncertain(false);
            submitLocked.current = false;
          }}
        />
      ) : null}

      {errorState ? (
        <div className="mt-4">
          <ErrorState status={errorState.status} title="创建班级失败" description={errorState.description} />
        </div>
      ) : null}
    </section>
  );
}
