import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { RemoveStudentButton } from "@/components/teacher/RemoveStudentButton";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import {
  toClassroomStudentsResponse,
  toClassroomSummary,
  type ClassroomStudent,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import {
  buildQueryString,
  getSingleSearchParam,
  parseBool01,
  toDisplayDate,
  toDisplayText,
} from "@/lib/ui/format";

type MembersPageProps = {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ includeRemoved?: string | string[] }>;
};

type MembersQueryState = {
  includeRemoved: boolean;
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

const extractRawDetail = (error: FetchJsonError): string | undefined => {
  if (typeof error.data === "string" && error.data.trim()) {
    return error.data;
  }

  if (!error.data || typeof error.data !== "object") {
    return undefined;
  }

  const message =
    "message" in error.data && typeof (error.data as { message?: unknown }).message === "string"
      ? String((error.data as { message: string }).message)
      : "";
  const code =
    "code" in error.data && typeof (error.data as { code?: unknown }).code === "string"
      ? String((error.data as { code: string }).code)
      : "";

  if (message && code) {
    return `${message} (code: ${code})`;
  }

  return message || code || undefined;
};

const buildErrorDescription = (summary: string, detail?: string): string =>
  detail ? `${summary} Detail: ${detail}` : summary;

const resolveQueryState = (
  query: Awaited<MembersPageProps["searchParams"]>
): MembersQueryState => ({
  includeRemoved: parseBool01(getSingleSearchParam(query.includeRemoved), false),
});

const toStatusUpper = (status?: string): string => (status ?? "").trim().toUpperCase();

const filterStudents = (students: ClassroomStudent[], includeRemoved: boolean): ClassroomStudent[] => {
  if (includeRemoved) {
    return students;
  }

  return students.filter((student) => toStatusUpper(student.status) !== "REMOVED");
};

const buildToggleHref = (classroomId: string, includeRemoved: boolean): string => {
  const query = buildQueryString({
    includeRemoved: String(includeRemoved),
  });
  const basePath = paths.teacher.classroomMembers(classroomId);
  return query ? `${basePath}?${query}` : basePath;
};

type MembersViewModel =
  | {
      mode: "ready";
      classroomName?: string;
      students: ClassroomStudent[];
      studentsRaw: unknown;
      query: MembersQueryState;
      listSourcePath: string;
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

export default async function ClassroomMembersPage({ params, searchParams }: MembersPageProps) {
  const { classroomId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);

  // Current backend has no dedicated GET /classrooms/:id/students endpoint.
  // Use enrollment-derived process-assessment items as member source (studentId list).
  const listSourcePath = `classrooms/${encodeURIComponent(
    classroomId
  )}/process-assessment?window=30d&page=1&limit=100&sort=score&order=desc`;

  let viewModel: MembersViewModel = {
    mode: "error",
    status: 500,
    description: "加载班级成员失败，请稍后重试。",
  };

  try {
    const origin = await getRequestOrigin();
    const [classroomPayload, studentsPayload] = await Promise.all([
      fetchJson<unknown>(`classrooms/${encodeURIComponent(classroomId)}`, {
        origin,
        cache: "no-store",
      }),
      fetchJson<unknown>(listSourcePath, {
        origin,
        cache: "no-store",
      }),
    ]);

    const classroom = toClassroomSummary(classroomPayload);
    const studentsResponse = toClassroomStudentsResponse(studentsPayload);
    const students = filterStudents(studentsResponse.items, queryState.includeRemoved);

    viewModel = {
      mode: "ready",
      classroomName: classroom.name,
      students,
      studentsRaw: studentsResponse.raw,
      query: queryState,
      listSourcePath,
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      const summaryByStatus: Record<number, string> = {
        401: "登录状态已失效，请重新登录。",
        403: "无权限管理该班级。",
        404: "成员管理功能未启用、不可用或资源不存在。",
      };
      const summary = summaryByStatus[error.status] ?? "加载班级成员失败，请稍后重试。";
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(summary, detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return <ErrorState status={viewModel.status} title="班级成员加载失败" description={viewModel.description} />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="班级成员"
        description={`${toDisplayText(viewModel.classroomName, "班级")}（ID: ${classroomId}）`}
        actions={
          <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-sm text-blue-700 hover:underline">
            返回班级看板
          </Link>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>成员以 Enrollment 为准；移除仅解除成员关系，不删除历史提交。</p>
        <p className="mt-1 text-xs text-zinc-500">当前成员列表来源：{viewModel.listSourcePath}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p className="font-medium text-zinc-900">筛选</p>
        <div className="mt-2">
          <Link
            href={buildToggleHref(classroomId, !viewModel.query.includeRemoved)}
            className="text-blue-700 hover:underline"
          >
            显示已移除成员：{viewModel.query.includeRemoved ? "开" : "关"}
          </Link>
        </div>
      </section>

      {viewModel.students.length === 0 ? (
        <EmptyState title="暂无成员数据" description="当前筛选条件下没有可展示成员。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3">学生</th>
                <th className="px-4 py-3">学号</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">加入时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.students.map((student, index) => {
                const statusUpper = toStatusUpper(student.status);
                const displayName =
                  student.name ?? student.email ?? student.userId ?? `成员 ${index + 1}`;

                return (
                  <tr key={student.userId ?? `member-${index}`} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900">{displayName}</p>
                      {student.email ? <p className="text-xs text-zinc-500">{student.email}</p> : null}
                    </td>
                    <td className="px-4 py-3">{toDisplayText(student.studentNo)}</td>
                    <td className="px-4 py-3">{toDisplayText(student.status, "—")}</td>
                    <td className="px-4 py-3">{toDisplayDate(student.enrolledAt)}</td>
                    <td className="px-4 py-3">
                      {statusUpper === "REMOVED" ? (
                        <span className="text-zinc-500">已移除</span>
                      ) : student.userId ? (
                        <RemoveStudentButton classroomId={classroomId} studentUserId={student.userId} />
                      ) : (
                        <span className="text-zinc-500">缺少 userId</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">查看原始成员 JSON</summary>
        <pre className="mt-3 overflow-auto text-xs text-zinc-700">
          {JSON.stringify(viewModel.studentsRaw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
