import type {
  CourseDetailResponse,
  UpdateCourseRequest,
} from "@/lib/api/types-teacher";
import {
  normalizeTaskCourseLabel,
  TASK_COURSE_LABEL_UNCLASSIFIED,
} from "@/lib/learning-tasks/course-labels";

type CourseEditFields = {
  code: string;
  name: string;
  term: string;
  courseLabel: string;
};

const toEditCourseLabel = (value: string | undefined) => {
  const label = normalizeTaskCourseLabel(value);
  return label && label !== TASK_COURSE_LABEL_UNCLASSIFIED ? label : "";
};

export function toCourseEditFields(
  course: Pick<CourseDetailResponse, keyof CourseEditFields>,
): CourseEditFields {
  return {
    code: course.code ?? "",
    name: course.name ?? "",
    term: course.term ?? "",
    courseLabel: toEditCourseLabel(course.courseLabel),
  };
}

export function buildCourseEditPatch(
  baseline: CourseEditFields,
  draft: CourseEditFields,
): UpdateCourseRequest | null {
  const code = draft.code.trim();
  const { name, term } = draft;
  if (!code || !name.trim() || !term.trim()) {
    return null;
  }

  const courseLabel = toEditCourseLabel(draft.courseLabel);
  const patch: UpdateCourseRequest = {};
  if (code !== baseline.code.trim()) patch.code = code;
  if (name !== baseline.name) patch.name = name;
  if (term !== baseline.term) patch.term = term;
  if (courseLabel !== toEditCourseLabel(baseline.courseLabel))
    patch.courseLabel = courseLabel;
  return patch;
}
