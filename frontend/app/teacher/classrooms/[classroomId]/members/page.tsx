import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@/components/blocks/EmptyState";
import { ErrorState } from "@/components/blocks/ErrorState";
import { PageHeader } from "@/components/blocks/PageHeader";
import { RemoveStudentButton } from "@/components/teacher/RemoveStudentButton";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  toClassroomStudentsResponse,
  toClassroomSummary,
  type ClassroomStudent,
} from "@/lib/api/types-teacher";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";
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
    }
  | {
      mode: "error";
      status: number;
      description: string;
    };

const getMembersErrorSummary = (status: number): string => {
  if (status === 403) {
    return "无权限访问对应页面。";
  }
  if (status >= 500) {
    return "加载失败，请稍后重试。";
  }
  return getCommonErrorSummary(status);
};

export default async function ClassroomMembersPage({ params, searchParams }: MembersPageProps) {
  const { classroomId } = await params;
  const rawQuery = await searchParams;
  const queryState = resolveQueryState(rawQuery);
  const studentsPath = `classrooms/${encodeURIComponent(classroomId)}/students?${buildQueryString({
    includeRemoved: queryState.includeRemoved ? "1" : "0",
  })}`;

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
      fetchJson<unknown>(studentsPath, {
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
    };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getMembersErrorSummary(error.status), detail),
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
        description={toDisplayText(viewModel.classroomName, "班级")}
        actions={
          <div className="flex items-center gap-3 text-sm">
            <Link href={paths.teacher.classroomDashboard(classroomId)} className="text-blue-700 hover:underline">
              返回班级看板
            </Link>
            <Link href={paths.teacher.classroomTasks(classroomId)} className="text-blue-700 hover:underline">
              课堂任务
            </Link>
          </div>
        }
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>成员以 Enrollment 为准；移除仅解除成员关系，不删除历史提交。</p>
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
        <EmptyState title="暂无成员" description="当前筛选条件下没有可展示成员。" />
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
                        <span className="text-zinc-500">缺少成员标识</span>
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
