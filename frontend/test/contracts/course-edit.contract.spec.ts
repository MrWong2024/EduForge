import { expect, test } from "@playwright/test";
import {
  toCourseDetailResponse,
  toCourseListResponse,
  toCourseSummary,
} from "../../lib/api/types-teacher";
import {
  buildCourseEditPatch,
  toCourseEditFields,
} from "../../lib/course-edit";

const courseResponse = {
  id: "course-edit-contract",
  code: " CS101 ",
  name: " 程序设计基础 ",
  term: " 2026 秋 ",
  courseLabel: "程序设计基础",
  status: "ACTIVE",
  createdBy: "teacher-course-edit-contract",
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-21T08:00:00.000Z",
};

const baseline = toCourseEditFields(toCourseDetailResponse(courseResponse));

for (const wrapped of [false, true]) {
  test(`course detail preserves legal name and term whitespace (${wrapped ? "data envelope" : "direct response"})`, () => {
    const detail = toCourseDetailResponse(
      wrapped ? { data: courseResponse } : courseResponse,
    );

    expect(detail.code).toBe("CS101");
    expect(detail.name).toBe(" 程序设计基础 ");
    expect(detail.term).toBe(" 2026 秋 ");
    expect(toCourseEditFields(detail)).toStrictEqual({
      code: "CS101",
      name: " 程序设计基础 ",
      term: " 2026 秋 ",
      courseLabel: "程序设计基础",
    });
  });
}

test("course summary and list keep their existing trimmed display values", () => {
  const summary = toCourseSummary(courseResponse);
  const list = toCourseListResponse({ items: [courseResponse] });

  expect(summary.name).toBe("程序设计基础");
  expect(summary.term).toBe("2026 秋");
  expect(list.items[0]?.name).toBe("程序设计基础");
  expect(list.items[0]?.term).toBe("2026 秋");
});

test("an untouched draft has no PATCH keys", () => {
  expect(buildCourseEditPatch(baseline, { ...baseline })).toStrictEqual({});
});

const singleFieldEdits = [
  {
    field: "code",
    value: " CS102 \t",
    expected: { code: "CS102" },
  },
  {
    field: "name",
    value: " 新课程名称 ",
    expected: { name: " 新课程名称 " },
  },
  {
    field: "term",
    value: " 2027 春 ",
    expected: { term: " 2027 春 " },
  },
  {
    field: "courseLabel",
    value: "数据结构",
    expected: { courseLabel: "数据结构" },
  },
] as const;

for (const { field, value, expected } of singleFieldEdits) {
  test(`editing only ${field} sends exactly that field`, () => {
    expect(
      buildCourseEditPatch(baseline, { ...baseline, [field]: value }),
    ).toStrictEqual(expected);
  });

  test(`restoring ${field} to its opening value removes its PATCH key`, () => {
    const edited = { ...baseline, [field]: value };
    expect(buildCourseEditPatch(baseline, edited)).toStrictEqual(expected);

    expect(
      buildCourseEditPatch(baseline, {
        ...edited,
        [field]: baseline[field],
      }),
    ).toStrictEqual({});
  });
}

test("editing multiple fields sends only their literal values without response metadata", () => {
  expect(
    buildCourseEditPatch(baseline, {
      code: " CS202 ",
      name: " 高级程序设计 ",
      term: " 2027 秋 ",
      courseLabel: "数据结构",
    }),
  ).toStrictEqual({
    code: "CS202",
    name: " 高级程序设计 ",
    term: " 2027 秋 ",
    courseLabel: "数据结构",
  });
});

test("restoring other edited fields leaves a term-only PATCH", () => {
  const edited = {
    code: "CS202",
    name: "新课程名称",
    term: " 2027 春 ",
    courseLabel: "数据结构",
  };

  expect(
    buildCourseEditPatch(baseline, {
      ...edited,
      code: baseline.code,
      name: baseline.name,
      courseLabel: baseline.courseLabel,
    }),
  ).toStrictEqual({ term: " 2027 春 " });
});

test("code whitespace alone is trim-equivalent to the opening value", () => {
  expect(
    buildCourseEditPatch(baseline, { ...baseline, code: " \tCS101  " }),
  ).toStrictEqual({});
  expect(
    buildCourseEditPatch(baseline, {
      ...baseline,
      code: " \tCS101  ",
      term: "2027 春",
    }),
  ).toStrictEqual({ term: "2027 春" });
});

const whitespaceEdits = [
  {
    label: "adding name whitespace",
    draft: { name: "  程序设计基础  " },
    expected: { name: "  程序设计基础  " },
  },
  {
    label: "removing name whitespace",
    draft: { name: "程序设计基础" },
    expected: { name: "程序设计基础" },
  },
  {
    label: "adding term whitespace",
    draft: { term: "  2026 秋  " },
    expected: { term: "  2026 秋  " },
  },
  {
    label: "removing term whitespace",
    draft: { term: "2026 秋" },
    expected: { term: "2026 秋" },
  },
] as const;

for (const { label, draft, expected } of whitespaceEdits) {
  test(`${label} is a real edit and preserves the exact text`, () => {
    expect(
      buildCourseEditPatch(baseline, { ...baseline, ...draft }),
    ).toStrictEqual(expected);
  });
}

for (const field of ["code", "name", "term"] as const) {
  for (const blank of ["", " \t\r\n"]) {
    test(`${field} rejects ${blank === "" ? "empty text" : "whitespace-only text"} instead of sending a partial request`, () => {
      expect(
        buildCourseEditPatch(baseline, {
          ...baseline,
          courseLabel: "数据结构",
          [field]: blank,
        }),
      ).toBeNull();
    });
  }
}

test("clearing a concrete classification sends only an empty courseLabel", () => {
  expect(
    buildCourseEditPatch(baseline, { ...baseline, courseLabel: "" }),
  ).toStrictEqual({ courseLabel: "" });
});

const unclassifiedResponses = [
  { label: "omitted courseLabel", courseLabel: undefined },
  { label: "explicit 未分类", courseLabel: "未分类" },
] as const;

for (const { label, courseLabel } of unclassifiedResponses) {
  test(`${label} uses the empty form option without sending an incidental clear`, () => {
    const detail = toCourseDetailResponse({
      id: "course-unclassified-contract",
      code: "CS101",
      name: " 程序设计基础 ",
      term: " 2026 秋 ",
      ...(courseLabel === undefined ? {} : { courseLabel }),
    });
    const unclassifiedBaseline = toCourseEditFields(detail);

    expect(unclassifiedBaseline).toStrictEqual({
      code: "CS101",
      name: " 程序设计基础 ",
      term: " 2026 秋 ",
      courseLabel: "",
    });
    expect(
      buildCourseEditPatch(unclassifiedBaseline, { ...unclassifiedBaseline }),
    ).toStrictEqual({});
    expect(
      buildCourseEditPatch(unclassifiedBaseline, {
        ...unclassifiedBaseline,
        term: " 2027 春 ",
      }),
    ).toStrictEqual({ term: " 2027 春 " });
    expect(
      buildCourseEditPatch(unclassifiedBaseline, {
        ...unclassifiedBaseline,
        courseLabel: "数据结构",
      }),
    ).toStrictEqual({ courseLabel: "数据结构" });
  });
}
