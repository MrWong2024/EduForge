import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  groupTeacherFeedbackItems,
  toTeacherFeedbackListResponse,
  type TeacherSubmissionContext,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
import { getSingleSearchParam, safeGet, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type TeacherSubmissionDetailPageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{
    classroomId?: string | string[];
    classroomTaskId?: string | string[];
    taskTitle?: string | string[];
    studentName?: string | string[];
    language?: string | string[];
    submittedAt?: string | string[];
    attemptNo?: string | string[];
    isLate?: string | string[];
    lateBySeconds?: string | string[];
    codeText?: string | string[];
  }>;
};

const getRequestOrigin = async (): Promise<string> => {
  const headerMap = await headers();
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }
  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};

const pickFirstNonEmptyRecord = (...candidates: unknown[]): UnknownRecord => {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asCodeText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asNumberLike = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const asBooleanLike = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }
  return undefined;
};

const getCandidateSubmissionRecord = (raw: unknown): UnknownRecord => {
  if (Array.isArray(raw)) {
    return {};
  }
  const record = asRecord(raw);
  return pickFirstNonEmptyRecord(
    safeGet(record, "submission", undefined),
    safeGet(record, "data.submission", undefined),
    safeGet(record, "meta.submission", undefined)
  );
};

const mergeContextFromPayload = (
  fallback: TeacherSubmissionContext,
  raw: unknown
): TeacherSubmissionContext => {
  const record = asRecord(raw);
  const submissionRecord = getCandidateSubmissionRecord(raw);
  const contentRecord = pickFirstNonEmptyRecord(
    safeGet(submissionRecord, "content", undefined),
    safeGet(record, "content", undefined),
    safeGet(record, "data.content", undefined)
  );

  return {
    submissionId: fallback.submissionId,
    classroomId:
      fallback.classroomId ??
      asString(safeGet(submissionRecord, "classroomId", undefined)) ??
      asString(safeGet(record, "classroomId", undefined)),
    classroomTaskId:
      fallback.classroomTaskId ??
      asString(safeGet(submissionRecord, "classroomTaskId", undefined)) ??
      asString(safeGet(record, "classroomTaskId", undefined)),
    taskTitle:
      fallback.taskTitle ??
      asString(safeGet(submissionRecord, "taskTitle", undefined)) ??
      asString(safeGet(record, "taskTitle", undefined)),
    studentName:
      fallback.studentName ??
      asString(safeGet(submissionRecord, "studentName", undefined)) ??
      asString(safeGet(record, "studentName", undefined)),
    language:
      fallback.language ??
      asString(safeGet(contentRecord, "language", undefined)) ??
      asString(safeGet(submissionRecord, "language", undefined)),
    submittedAt:
      fallback.submittedAt ??
      asString(safeGet(submissionRecord, "submittedAt", undefined)) ??
      asString(safeGet(submissionRecord, "createdAt", undefined)) ??
      asString(safeGet(record, "submittedAt", undefined)),
    attemptNo:
      fallback.attemptNo ??
      asNumberLike(safeGet(submissionRecord, "attemptNo", undefined)) ??
      asNumberLike(safeGet(record, "attemptNo", undefined)),
    isLate:
      fallback.isLate ??
      asBooleanLike(safeGet(submissionRecord, "isLate", undefined)) ??
      asBooleanLike(safeGet(record, "isLate", undefined)),
    lateBySeconds:
      fallback.lateBySeconds ??
      asNumberLike(safeGet(submissionRecord, "lateBySeconds", undefined)) ??
      asNumberLike(safeGet(record, "lateBySeconds", undefined)),
    codeText:
      fallback.codeText ??
      asCodeText(safeGet(contentRecord, "codeText", undefined)) ??
      asCodeText(safeGet(submissionRecord, "codeText", undefined)),
  };
};

const parseQueryNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type SubmissionFeedbackViewModel =
  | {
      mode: "ready";
      feedback: ReturnType<typeof toTeacherFeedbackListResponse>;
      context: TeacherSubmissionContext;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function TeacherSubmissionDetailPage({
  params,
  searchParams,
}: TeacherSubmissionDetailPageProps) {
  const { submissionId } = await params;
  const query = await searchParams;
  const classroomId = getSingleSearchParam(query.classroomId);
  const classroomTaskId = getSingleSearchParam(query.classroomTaskId);
  const queryContext: TeacherSubmissionContext = {
    submissionId,
    classroomId,
    classroomTaskId,
    taskTitle: getSingleSearchParam(query.taskTitle),
    studentName: getSingleSearchParam(query.studentName),
    language: getSingleSearchParam(query.language),
    submittedAt: getSingleSearchParam(query.submittedAt),
    attemptNo: parseQueryNumber(getSingleSearchParam(query.attemptNo)),
    isLate: asBooleanLike(getSingleSearchParam(query.isLate)),
    lateBySeconds: parseQueryNumber(getSingleSearchParam(query.lateBySeconds)),
    codeText: getSingleSearchParam(query.codeText),
  };

  let viewModel: SubmissionFeedbackViewModel = {
    mode: "error",
    status: 500,
    description: "加载提交反馈失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const payload = await fetchJson<unknown>(
      `learning-tasks/submissions/${encodeURIComponent(submissionId)}/feedback`,
      {
        origin,
        cache: "no-store",
      }
    );

    const feedback = toTeacherFeedbackListResponse(payload);
    viewModel = {
      mode: "ready",
      feedback,
      context: mergeContextFromPayload(queryContext, feedback.raw),
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summary =
        error.status === 403
          ? "无权限查看或批阅该提交。"
          : getCommonErrorSummary(error.status, "加载提交反馈");

      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState
        status={viewModel.status}
        title="提交详情加载失败"
        description={viewModel.description}
      />
    );
  }

  const backHref =
    viewModel.context.classroomId && viewModel.context.classroomTaskId
      ? paths.teacher.classroomTaskSubmissions(
          viewModel.context.classroomId,
          viewModel.context.classroomTaskId
        )
      : null;
  const taskHref =
    viewModel.context.classroomId && viewModel.context.classroomTaskId
      ? paths.teacher.classroomTaskDetail(viewModel.context.classroomId, viewModel.context.classroomTaskId)
      : null;
  const groupedFeedback = groupTeacherFeedbackItems(viewModel.feedback.items);
  const groupedSections = [
    { key: "teacher", title: "教师反馈", items: groupedFeedback.teacher },
    { key: "ai", title: "AI 反馈", items: groupedFeedback.ai },
    { key: "system", title: "系统反馈", items: groupedFeedback.system },
  ] as const;

  return (
    <section className="space-y-4">
      <PageHeader
        title="提交详情 / 教师批阅"
        description={`submissionId: ${viewModel.context.submissionId}`}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {backHref ? (
              <Link href={backHref} className="text-blue-700 hover:underline">
                返回任务提交列表
              </Link>
            ) : null}
            {taskHref ? (
              <Link href={taskHref} className="text-blue-700 hover:underline">
                返回任务详情
              </Link>
            ) : null}
            <Link href={paths.teacher.classrooms} className="text-blue-700 hover:underline">
              返回班级列表
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">提交概览</h2>
        <div className="mt-3 grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
          <div>
            <p className="text-zinc-500">submissionId</p>
            <p className="font-medium text-zinc-900">{toDisplayText(viewModel.context.submissionId)}</p>
          </div>
          <div>
            <p className="text-zinc-500">课堂任务 ID</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.classroomTaskId)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">任务标题</p>
            <p className="font-medium text-zinc-900">{toDisplayText(viewModel.context.taskTitle)}</p>
          </div>
          <div>
            <p className="text-zinc-500">学生</p>
            <p className="font-medium text-zinc-900">{toDisplayText(viewModel.context.studentName)}</p>
          </div>
          <div>
            <p className="text-zinc-500">语言</p>
            <p className="font-medium text-zinc-900">{toDisplayText(viewModel.context.language)}</p>
          </div>
          <div>
            <p className="text-zinc-500">提交时间</p>
            <p className="font-medium text-zinc-900">{toDisplayDate(viewModel.context.submittedAt)}</p>
          </div>
          <div>
            <p className="text-zinc-500">尝试次数</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.attemptNo)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">是否迟交</p>
            <p className="font-medium text-zinc-900">
              {toDisplayText(viewModel.context.isLate)}
              {viewModel.context.isLate && asNumber(viewModel.context.lateBySeconds) !== undefined
                ? `（超时 ${viewModel.context.lateBySeconds} 秒）`
                : ""}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">提交内容</h2>
        {viewModel.context.codeText ? (
          <details className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看代码内容</summary>
            <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-xs text-zinc-100">
              {viewModel.context.codeText}
            </pre>
          </details>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">
            当前接口未返回代码内容，可通过原始记录确认。
          </p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>当前页用于教师批阅闭环：可查看反馈历史并新增教师反馈。</p>
      </section>

      <TeacherFeedbackForm submissionId={submissionId} />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">反馈历史</h2>
        {viewModel.feedback.items.length === 0 ? (
          <EmptyState title="暂无反馈记录" description="可先在上方填写教师反馈。" />
        ) : (
          groupedSections.map((section) => (
            <section key={section.key} className="rounded-lg border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-zinc-900">{section.title}</h3>
              {section.items.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">暂无该来源反馈。</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {section.items.map((item, index) => (
                    <li
                      key={item.id ?? `${section.key}-${index}`}
                      className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                    >
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-zinc-900 px-2 py-1 font-medium text-white">
                          {toDisplayText(item.source)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {toDisplayText(item.severity)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {toDisplayText(item.type)}
                        </span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-900">
                        {toDisplayText(item.message)}
                      </p>
                      <p className="mt-2 text-sm text-zinc-700">
                        建议：{toDisplayText(item.suggestion)}
                      </p>
                      <p className="mt-1 text-sm text-zinc-700">
                        标签：{item.tags.length > 0 ? item.tags.join(", ") : "—"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">{toDisplayDate(item.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </section>

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">
          查看原始反馈 JSON
        </summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.feedback.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
