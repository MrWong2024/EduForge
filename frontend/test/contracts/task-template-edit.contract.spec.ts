import { expect, test } from "@playwright/test";
import {
  toLearningTaskCreateResponse,
  toLearningTaskDetailResponse,
  toLearningTaskUpdateResponse,
  type UpdateLearningTaskRequest,
} from "../../lib/api/types-teacher";
import {
  buildTaskTemplateEditRequest,
  confirmTaskTemplateEditReceipt,
  toTaskTemplateEditDraft,
  type TaskTemplateEditDraft,
} from "../../lib/learning-tasks/template-edit";

const description = "  原文第一行\n    内部缩进\n末行\n\n";
const refs = [
  {
    archivePath: "book/teacher.zip",
    entryPaths: ["teacher/guide.md", "teacher/alternate.md"],
  },
  { archivePath: "book/student.zip", entryPaths: ["src/C++.cpp"] },
];
const latestRefs = [
  { archivePath: "book/teacher.zip", entryPaths: ["teacher/alternate.md"] },
];
const receipt = {
  id: "task-1",
  title: "原标题",
  description,
  knowledgeModule: "原知识模块",
  courseLabel: "数据结构",
  visibility: "PRIVATE",
  difficulty: "easy",
  rubric: {
    notes: "  旧评阅文字\n ",
    scoring: { correctness: 70 },
    other: "保留",
  },
  aiContextRefs: refs,
  status: "DRAFT",
  createdBy: "author-1",
};
const baseline: TaskTemplateEditDraft = {
  title: "原标题",
  description,
  knowledgeModule: "原知识模块",
  courseLabel: "数据结构",
  visibility: "PRIVATE",
  difficulty: "easy",
  rubricNotes: "  旧评阅文字\n ",
  aiContextText: JSON.stringify(refs),
};

test("detail, create and update adapters preserve description text through the edit draft", () => {
  for (const adapt of [
    toLearningTaskDetailResponse,
    toLearningTaskCreateResponse,
    toLearningTaskUpdateResponse,
  ]) {
    for (const payload of [receipt, { data: receipt }]) {
      const task = adapt(payload);
      expect(task.description).toBe("  原文第一行\n    内部缩进\n末行\n\n");
      expect(toTaskTemplateEditDraft(task).description).toBe(
        "  原文第一行\n    内部缩进\n末行\n\n",
      );
    }
  }
});

test("a title-only edit omits all other fields including the complete existing rubric", () => {
  const loaded = toTaskTemplateEditDraft(toLearningTaskDetailResponse(receipt));
  expect(
    buildTaskTemplateEditRequest(loaded, { ...loaded, title: "  新标题  " }),
  ).toStrictEqual({
    kind: "changed",
    payload: { title: "新标题" },
  });
});

const changedFields: {
  field: keyof TaskTemplateEditDraft;
  value: string;
  expected: UpdateLearningTaskRequest;
}[] = [
  {
    field: "description",
    value: "  新描述\n    新缩进\n\n",
    expected: { description: "  新描述\n    新缩进\n\n" },
  },
  {
    field: "knowledgeModule",
    value: "  新知识模块  ",
    expected: { knowledgeModule: "新知识模块" },
  },
  {
    field: "courseLabel",
    value: "软件工程",
    expected: { courseLabel: "软件工程" },
  },
  { field: "visibility", value: "SHARED", expected: { visibility: "SHARED" } },
  { field: "difficulty", value: "hard", expected: { difficulty: "hard" } },
  {
    field: "rubricNotes",
    value: "  新评阅文字\n内部保留  ",
    expected: { rubric: { notes: "新评阅文字\n内部保留" } },
  },
  {
    field: "aiContextText",
    value: JSON.stringify(latestRefs),
    expected: { aiContextRefs: latestRefs },
  },
];
for (const { field, value, expected } of changedFields) {
  test(`editing only ${field} sends exactly that field`, () => {
    expect(
      buildTaskTemplateEditRequest(baseline, { ...baseline, [field]: value }),
    ).toStrictEqual({
      kind: "changed",
      payload: expected,
    });
  });
}

for (const { field, value, expected } of [
  { field: "courseLabel", value: "", expected: { courseLabel: "" } },
  { field: "difficulty", value: "", expected: { difficulty: "" } },
  { field: "rubricNotes", value: " \n ", expected: { rubric: {} } },
  { field: "aiContextText", value: "[]", expected: { aiContextRefs: [] } },
] as const) {
  test(`explicitly clearing ${field} sends its existing clear representation`, () => {
    expect(
      buildTaskTemplateEditRequest(baseline, { ...baseline, [field]: value }),
    ).toStrictEqual({
      kind: "changed",
      payload: expected,
    });
  });
}

test("missing and literal unclassified course labels remain omitted during an unrelated edit", () => {
  for (const courseLabel of [undefined, "未分类"]) {
    const loaded = toTaskTemplateEditDraft(
      toLearningTaskDetailResponse({ ...receipt, courseLabel }),
    );
    expect(loaded.courseLabel).toBe("");
    expect(
      buildTaskTemplateEditRequest(loaded, { ...loaded, title: "新标题" }),
    ).toStrictEqual({
      kind: "changed",
      payload: { title: "新标题" },
    });
  }
});

test("no net change, trimmed-only changes and restored edits produce no PATCH", () => {
  expect(buildTaskTemplateEditRequest(baseline, { ...baseline })).toStrictEqual(
    { kind: "unchanged" },
  );
  expect(
    buildTaskTemplateEditRequest(baseline, {
      ...baseline,
      title: " 原标题 ",
      knowledgeModule: "\n原知识模块  ",
      rubricNotes: "旧评阅文字",
      aiContextText: JSON.stringify(refs, null, 4),
    }),
  ).toStrictEqual({ kind: "unchanged" });
  const changed = {
    ...baseline,
    title: "暂时修改",
    description: "临时描述",
    aiContextText: "[]",
  };
  expect(buildTaskTemplateEditRequest(baseline, changed).kind).toBe("changed");
  expect(
    buildTaskTemplateEditRequest(baseline, { ...changed, ...baseline }),
  ).toStrictEqual({ kind: "unchanged" });
});

test("a description-only added newline is a real verbatim edit", () => {
  expect(
    buildTaskTemplateEditRequest(baseline, {
      ...baseline,
      description: description + "\n",
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { description: "  原文第一行\n    内部缩进\n末行\n\n\n" },
  });
});

for (const field of ["title", "description", "knowledgeModule"] as const) {
  test(`whitespace-only ${field} blocks the entire edit`, () => {
    const result = buildTaskTemplateEditRequest(baseline, {
      ...baseline,
      title: "另一个修改",
      [field]: " \n\t ",
    });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.field).toBe(field);
    expect(result).not.toHaveProperty("payload");
  });
}

test("invalid references block other edits while array and entry order remain significant", () => {
  for (const aiContextText of [
    "",
    "[{]",
    "null",
    '[{"archivePath":"a.zip","entryPaths":[]}]',
  ]) {
    const result = buildTaskTemplateEditRequest(baseline, {
      ...baseline,
      title: "不应部分保存",
      aiContextText,
    });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.field).toBe("aiContextText");
    expect(result).not.toHaveProperty("payload");
  }
  const reordered = [
    refs[1],
    { ...refs[0], entryPaths: ["teacher/alternate.md", "teacher/guide.md"] },
  ];
  expect(
    buildTaskTemplateEditRequest(baseline, {
      ...baseline,
      aiContextText: JSON.stringify(reordered),
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { aiContextRefs: reordered },
  });
});

test("an omitted-reference save accepts and adopts the latest complete official response", () => {
  const saved = confirmTaskTemplateEditReceipt(
    "task-1",
    {
      data: {
        ...receipt,
        title: "新标题",
        description: "  另一页的描述\n    保留缩进\n",
        knowledgeModule: "新模块",
        courseLabel: "软件工程",
        visibility: "SHARED",
        difficulty: "hard",
        rubric: { notes: "新评阅文字", scoring: { correctness: 80 } },
        aiContextRefs: latestRefs,
        status: "PUBLISHED",
      },
    },
    { title: "新标题" },
  );
  expect(saved.kind).toBe("valid");
  if (saved.kind !== "valid") throw new Error("Expected a confirmed receipt");
  expect(saved.task.status).toBe("PUBLISHED");
  expect(saved.task.createdById).toBe("author-1");
  expect(saved.task.aiContextRefs).toStrictEqual(latestRefs);
  expect(saved.draft).toStrictEqual({
    title: "新标题",
    description: "  另一页的描述\n    保留缩进\n",
    knowledgeModule: "新模块",
    courseLabel: "软件工程",
    visibility: "SHARED",
    difficulty: "hard",
    rubricNotes: "新评阅文字",
    aiContextText: JSON.stringify(latestRefs, null, 2),
  });
  expect(
    buildTaskTemplateEditRequest(saved.draft, { ...saved.draft }),
  ).toStrictEqual({ kind: "unchanged" });
  expect(
    buildTaskTemplateEditRequest(saved.draft, {
      ...saved.draft,
      title: "再次改标题",
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { title: "再次改标题" },
  });
});

test("explicit references require a matching returned array including an explicit clear", () => {
  expect(
    confirmTaskTemplateEditReceipt(
      "task-1",
      { ...receipt, aiContextRefs: latestRefs },
      { aiContextRefs: latestRefs },
    ).kind,
  ).toBe("valid");
  expect(
    confirmTaskTemplateEditReceipt(
      "task-1",
      { ...receipt, aiContextRefs: [] },
      { aiContextRefs: [] },
    ).kind,
  ).toBe("valid");
  for (const aiContextRefs of [refs, [], undefined]) {
    expect(
      confirmTaskTemplateEditReceipt(
        "task-1",
        { ...receipt, aiContextRefs },
        { aiContextRefs: latestRefs },
      ).kind,
    ).toBe("invalid");
  }
  expect(
    confirmTaskTemplateEditReceipt(
      "task-1",
      { ...receipt, aiContextRefs: undefined },
      { aiContextRefs: [] },
    ).kind,
  ).toBe("invalid");
  expect(
    confirmTaskTemplateEditReceipt(
      "task-1",
      { ...receipt, aiContextRefs: undefined },
      { title: "新标题" },
    ).kind,
  ).toBe("valid");
});

test("wrong targets and incomplete receipts cannot confirm a save", () => {
  expect(
    confirmTaskTemplateEditReceipt("other-task", receipt, { title: "新标题" })
      .kind,
  ).toBe("invalid");
  for (const field of [
    "id",
    "title",
    "description",
    "knowledgeModule",
    "status",
    "visibility",
    "createdBy",
  ]) {
    const incomplete: Record<string, unknown> = { ...receipt };
    delete incomplete[field];
    expect(
      confirmTaskTemplateEditReceipt("task-1", incomplete, { title: "新标题" })
        .kind,
    ).toBe("invalid");
  }
});

test("invalid source fields cannot become a successful receipt through adapter fallbacks", () => {
  for (const invalid of [
    { title: 3 },
    { description: ["文字"] },
    { description: " \n " },
    { knowledgeModule: {} },
    { status: ["PUBLISHED"] },
    { status: "UNKNOWN" },
    { visibility: false },
    { courseLabel: {} },
    { difficulty: 0 },
    { rubric: [] },
    { rubric: { notes: 7 } },
    { aiContextRefs: null },
    { aiContextRefs: {} },
    { aiContextRefs: [{ ...refs[0], entryPaths: [] }] },
  ]) {
    const result = confirmTaskTemplateEditReceipt(
      "task-1",
      { ...receipt, ...invalid },
      { title: "新标题" },
    );
    expect(result.kind).toBe("invalid");
    expect(result).not.toHaveProperty("draft");
    expect(result).not.toHaveProperty("task");
  }
});
