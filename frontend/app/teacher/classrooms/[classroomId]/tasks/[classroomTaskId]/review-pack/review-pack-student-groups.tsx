import type {
  ReviewPackStudentTiers,
  ReviewPackTierStudentItem,
} from "@/lib/api/types-teacher";

const STUDENT_TIER_PREVIEW_COUNT = 6;

const STUDENT_GROUPS = [
  {
    key: "good",
    title: "AI 评阅未报错误",
    description: "窗口内最新一次提交的 AI 评阅已成功，错误级反馈为 0 条。",
  },
  {
    key: "watch",
    title: "已提交，需核对",
    description: "窗口内已有提交，最新一次提交有 AI 错误级反馈，或尚无成功的 AI 评阅结果。",
  },
  {
    key: "notSubmitted",
    title: "窗口内未提交",
    description: "在所选时间窗口内没有提交记录。",
  },
] as const;

export function buildReviewPackStudentGroups(studentTiers: ReviewPackStudentTiers) {
  return STUDENT_GROUPS.map((group) => ({ ...group, students: studentTiers[group.key] }));
}

type StudentGroups = ReturnType<typeof buildReviewPackStudentGroups>;

export function summarizeReviewPackStudentGroups(groups: StudentGroups): string {
  if (groups.every(({ students }) => students.length === 0)) {
    return "当前未返回有效学生分层数据。";
  }
  return `学生分层：${groups.map(({ title, students }) => `${title} ${students.length} 人`).join("、")}。`;
}

export function describeRepeatSubmissions(attemptTwo?: number, attemptThreePlus?: number): string {
  const facts: string[] = [];
  if (typeof attemptTwo === "number" && attemptTwo > 0) {
    facts.push(`有 ${attemptTwo} 名学生在窗口内提交 2 次。`);
  }
  if (typeof attemptThreePlus === "number" && attemptThreePlus > 0) {
    facts.push(`有 ${attemptThreePlus} 名学生在窗口内提交 3 次及以上。`);
  }
  return facts.join("");
}

function StudentRow({ student, submitted }: { student: ReviewPackTierStudentItem; submitted: boolean }) {
  const { studentName, studentNo, attemptsCount, latestErrorCount } = student;
  return (
    <li className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs">
      <p className="font-medium text-zinc-800">{studentName ?? "未知学生"}</p>
      {studentNo ? <p className="text-zinc-500">学号：{studentNo}</p> : null}
      {submitted ? (
        <p className="text-zinc-500">
          窗口内提交次数：{attemptsCount === undefined ? "—" : `${attemptsCount} 次`} · 最新提交的 AI 错误级反馈：
          {latestErrorCount === undefined ? "—" : `${latestErrorCount} 条`}
        </p>
      ) : null}
    </li>
  );
}

export function ReviewPackStudentGroupCards({ groups }: { groups: StudentGroups }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">学生分层</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {groups.map(({ key, title, description, students }) => {
          const submitted = key !== "notSubmitted";
          const renderRow = (student: ReviewPackTierStudentItem, index: number) => (
            <StudentRow key={`${student.studentId ?? "unknown"}-${index}`} student={student} submitted={submitted} />
          );
          return (
            <article key={key} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <h3 className="font-medium text-zinc-900">{title}（{students.length}）</h3>
              <p className="mt-1 text-xs text-zinc-500">{description}</p>
              {students.length > 0 ? (
                <>
                  <ul className="mt-2 space-y-1">
                    {students.slice(0, STUDENT_TIER_PREVIEW_COUNT).map(renderRow)}
                  </ul>
                  {students.length > STUDENT_TIER_PREVIEW_COUNT ? (
                    <details className="group mt-2">
                      <summary className="cursor-pointer text-xs text-blue-700 hover:underline">
                        <span className="group-open:hidden">展开全部</span>
                        <span className="hidden group-open:inline">收起</span>
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {students.slice(STUDENT_TIER_PREVIEW_COUNT).map(renderRow)}
                      </ul>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-zinc-600">当前分组暂无学生。</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
