import {
  toCourseDetailResponse,
  type ClassroomSummary,
  type CourseListResponse,
  type CourseSummary,
} from "./api/types-teacher";

type CourseOptionSource = Pick<CourseSummary, "id" | "code" | "name">;
export type ClassroomCourseOption = CourseOptionSource & { id: string };

const COURSES_PAGE_SIZE = 100;

export function classroomCoursePagePath(page: number): string {
  return `courses?page=${page}&limit=${COURSES_PAGE_SIZE}`;
}

export function nextClassroomCoursePage(
  response: CourseListResponse,
  page: number,
): number | undefined {
  const limit = response.limit ?? COURSES_PAGE_SIZE;
  if (limit > 0 && response.total !== undefined && response.total > page * limit) {
    return page + 1;
  }
  return undefined;
}

export function mergeClassroomCourseOptions(
  current: ClassroomCourseOption[],
  incoming: CourseOptionSource[],
): ClassroomCourseOption[] {
  const byId = new Map(current.map((course) => [course.id, course]));
  for (const { id, code, name } of incoming) {
    if (id && !byId.has(id)) {
      byId.set(id, { id, code, name });
    }
  }
  return Array.from(byId.values());
}

export function selectClassroomCreationCourseId(
  courses: ClassroomCourseOption[],
  preferredCourseId?: string,
): string {
  if (preferredCourseId === undefined) {
    return courses[0]?.id ?? "";
  }
  return courses.some((course) => course.id === preferredCourseId) ? preferredCourseId : "";
}

export async function readClassroomCreationCourse(
  requestedCourseId: string,
  readCourse: (id: string) => Promise<unknown>,
): Promise<ClassroomCourseOption | undefined> {
  const { id, code, name } = toCourseDetailResponse(await readCourse(requestedCourseId));
  return id === requestedCourseId ? { id, code, name } : undefined;
}

export async function resolveClassroomCreationCourses(
  firstPage: CourseListResponse,
  requestedCourseId: string | undefined,
  readCourse: (id: string) => Promise<unknown>,
) {
  let courses = mergeClassroomCourseOptions([], firstPage.items);
  if (requestedCourseId && !courses.some((course) => course.id === requestedCourseId)) {
    try {
      const target = await readClassroomCreationCourse(requestedCourseId, readCourse);
      if (target) {
        courses = mergeClassroomCourseOptions(courses, [target]);
      }
    } catch {
      // The classroom list remains usable when the creation target cannot be read.
    }
  }

  const initialCourseId = requestedCourseId === undefined
    ? courses[0]?.id
    : courses.find((course) => course.id === requestedCourseId)?.id;
  return {
    courses,
    initialCourseId,
    targetUnavailable: requestedCourseId !== undefined && initialCourseId === undefined,
    nextPage: nextClassroomCoursePage(firstPage, 1),
  };
}

export function classroomCourseName(
  classroom: ClassroomSummary,
  courseNames: ReadonlyMap<string, string | undefined>,
): string {
  const fallback = classroom.courseId ? courseNames.get(classroom.courseId) : undefined;
  return classroom.course?.name?.trim() || fallback?.trim() || "未知课程";
}
