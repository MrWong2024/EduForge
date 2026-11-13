import type { LearningTrajectoryStudentPublic } from "@/lib/api/types-teacher";

type StudentDisplayFields = Pick<
  LearningTrajectoryStudentPublic,
  "name" | "studentNo" | "email"
>;

const trimText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const toLearningTrajectoryStudentDisplayName = (
  student: StudentDisplayFields | undefined,
): string => {
  const name = trimText(student?.name);
  if (name) {
    return name;
  }

  const studentNo = trimText(student?.studentNo);
  if (studentNo) {
    return `学号：${studentNo}`;
  }

  return trimText(student?.email) ?? "未知学生";
};
