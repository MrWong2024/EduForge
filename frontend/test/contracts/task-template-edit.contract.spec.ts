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
  reconcileTaskTemplatePublishedDraft,
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
const published: TaskTemplateEditDraft = {
  title: "发布时的远端标题",
  description: "  发布时的描述\n    保留缩进\n",
  knowledgeModule: "发布时的知识模块",
  courseLabel: "软件工程",
  visibility: "SHARED",
  difficulty: "hard",
  rubricNotes: "发布时的评阅文字",
  aiContextText: JSON.stringify(latestRefs, null, 2),
};

const newlineReceipt = {
  ...receipt,
  title: " 原\r\n标\r题\n ",
  description: "  原文第一行\r\n    内部缩进\r末行\n\n",
  knowledgeModule: " 原\r知\n识\r\n模块 ",
  rubric: {
    notes: "  旧评阅文字\r\n    内部说明\r末行\n\n",
    criterion: { correctness: 70 },
  },
};
const newlineBaseline = Object.freeze(
  toTaskTemplateEditDraft(toLearningTaskDetailResponse(newlineReceipt)),
);

test("template CRLF description and notes restored in textareas leave only knowledgeModule", () => {
  expect(newlineBaseline.description).toBe(
    "  原文第一行\r\n    内部缩进\r末行\n\n",
  );
  expect(newlineBaseline.rubricNotes).toBe(
    "  旧评阅文字\r\n    内部说明\r末行\n\n",
  );
  expect(
    buildTaskTemplateEditRequest(newlineBaseline, {
      ...newlineBaseline,
      description: "  原文第一行\n    内部缩进\n末行\n\n",
      rubricNotes: "  旧评阅文字\n    内部说明\n末行\n\n",
      knowledgeModule: "  新知识模块  ",
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { knowledgeModule: "新知识模块" },
  });
});

test("restored template multiline text omits the complete rubric and produces no PATCH", () => {
  expect(
    buildTaskTemplateEditRequest(newlineBaseline, {
      ...newlineBaseline,
      description: "  原文第一行\n    内部缩进\n末行\n\n",
      rubricNotes: "  旧评阅文字\n    内部说明\n末行\n\n",
    }),
  ).toStrictEqual({ kind: "unchanged" });
});

for (const { field, restored } of [
  { field: "title", restored: "  原标题  " },
  { field: "knowledgeModule", restored: " 原知识模块 " },
] as const) {
  test(`restored single-line template ${field} removes CR and LF before its existing trim comparison`, () => {
    expect(
      buildTaskTemplateEditRequest(newlineBaseline, {
        ...newlineBaseline,
        [field]: restored,
      }),
    ).toStrictEqual({ kind: "unchanged" });
  });
}

for (const { label, value, expected } of [
  {
    label: "adding an internal line",
    value: "  原文第一行\n    内部缩进\n新增一行\n末行\n\n",
    expected: {
      description: "  原文第一行\n    内部缩进\n新增一行\n末行\n\n",
    },
  },
  {
    label: "removing an internal line",
    value: "  原文第一行\n末行\n\n",
    expected: { description: "  原文第一行\n末行\n\n" },
  },
  {
    label: "changing indentation",
    value: "  原文第一行\n  内部缩进\n末行\n\n",
    expected: { description: "  原文第一行\n  内部缩进\n末行\n\n" },
  },
  {
    label: "adding a trailing blank line",
    value: "  原文第一行\n    内部缩进\n末行\n\n\n",
    expected: { description: "  原文第一行\n    内部缩进\n末行\n\n\n" },
  },
  {
    label: "removing a trailing blank line",
    value: "  原文第一行\n    内部缩进\n末行\n",
    expected: { description: "  原文第一行\n    内部缩进\n末行\n" },
  },
  {
    label: "editing raw text with mixed line endings",
    value: "  新首行\r\n    原样缩进\r末行\n\n",
    expected: { description: "  新首行\r\n    原样缩进\r末行\n\n" },
  },
]) {
  test(`${label} remains a verbatim description-only PATCH`, () => {
    expect(
      buildTaskTemplateEditRequest(newlineBaseline, {
        ...newlineBaseline,
        description: value,
      }),
    ).toStrictEqual({ kind: "changed", payload: expected });
  });
}

test("a real multiline rubric edit keeps its existing trim-only serialization", () => {
  expect(
    buildTaskTemplateEditRequest(newlineBaseline, {
      ...newlineBaseline,
      rubricNotes: "  新\r\n评阅\r文字\n保留  ",
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { rubric: { notes: "新\r\n评阅\r文字\n保留" } },
  });
});

test("clearing newline-containing rubric notes still sends the empty object", () => {
  expect(
    buildTaskTemplateEditRequest(newlineBaseline, {
      ...newlineBaseline,
      rubricNotes: " \r\n \r \n\t ",
    }),
  ).toStrictEqual({ kind: "changed", payload: { rubric: {} } });
});

test("publishing adopts receipt description and notes after newline-only restoration while keeping a real local title draft", () => {
  const publishedDraft = toTaskTemplateEditDraft(
    toLearningTaskUpdateResponse({
      ...receipt,
      title: "发布回执新标题",
      description: "  发布回执描述\r\n    新缩进\r\n",
      rubric: {
        notes: " 发布回执\r\n新评阅 ",
        criterion: { correctness: 90 },
      },
      status: "PUBLISHED",
    }),
  );
  const reconciled = reconcileTaskTemplatePublishedDraft(
    newlineBaseline,
    {
      ...newlineBaseline,
      title: "  本地未保存标题  ",
      description: "  原文第一行\n    内部缩进\n末行\n\n",
      rubricNotes: "  旧评阅文字\n    内部说明\n末行\n\n",
    },
    publishedDraft,
  );

  expect(reconciled.title).toBe("  本地未保存标题  ");
  expect(reconciled.description).toBe("  发布回执描述\r\n    新缩进\r\n");
  expect(reconciled.rubricNotes).toBe(" 发布回执\r\n新评阅 ");
  expect(
    buildTaskTemplateEditRequest(publishedDraft, reconciled),
  ).toStrictEqual({
    kind: "changed",
    payload: { title: "本地未保存标题" },
  });
});

test("publishing keeps real local description and rubric drafts verbatim while adopting a restored title", () => {
  const reconciled = reconcileTaskTemplatePublishedDraft(
    newlineBaseline,
    {
      ...newlineBaseline,
      title: "原标题",
      description: "  原文第一行\n  本地缩进\n末行\n\n\n",
      rubricNotes: "  本地评阅\r\n    保留缩进\n ",
    },
    published,
  );

  expect(reconciled.title).toBe("发布时的远端标题");
  expect(reconciled.description).toBe("  原文第一行\n  本地缩进\n末行\n\n\n");
  expect(reconciled.rubricNotes).toBe("  本地评阅\r\n    保留缩进\n ");
  expect(buildTaskTemplateEditRequest(published, reconciled)).toStrictEqual({
    kind: "changed",
    payload: {
      description: "  原文第一行\n  本地缩进\n末行\n\n\n",
      rubric: { notes: "本地评阅\r\n    保留缩进" },
    },
  });
});

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

test("unsubmitted numeric rubric notes do not invalidate content or lifecycle receipts", () => {
  for (const { status, submitted } of [
    { status: "DRAFT", submitted: { title: "新标题" } },
    { status: "PUBLISHED", submitted: {} },
    { status: "ARCHIVED", submitted: {} },
  ]) {
    const result = confirmTaskTemplateEditReceipt(
      "task-1",
      {
        ...receipt,
        title: "新标题",
        status,
        rubric: { notes: 7, scoring: { correctness: 70 } },
      },
      submitted,
    );
    expect(result.kind).toBe("valid");
    if (result.kind !== "valid")
      throw new Error("Expected a confirmed receipt");
    expect(result.task.raw.rubric).toStrictEqual({
      notes: 7,
      scoring: { correctness: 70 },
    });
    expect(result.draft.rubricNotes).toBe("");
  }
});

test("unsubmitted rubric internal values and outer null retain the existing notes display semantics", () => {
  for (const rubric of [
    null,
    { notes: null },
    { notes: false },
    { notes: ["文字"] },
    { notes: { text: "文字" }, arbitrary: [1, null, true] },
  ]) {
    for (const submitted of [{ title: "新标题" }, {}]) {
      const result = confirmTaskTemplateEditReceipt(
        "task-1",
        { ...receipt, title: "新标题", rubric },
        submitted,
      );
      expect(result.kind).toBe("valid");
      if (result.kind !== "valid")
        throw new Error("Expected a confirmed receipt");
      expect(result.task.raw.rubric).toStrictEqual(rubric);
      expect(result.draft.rubricNotes).toBe("");
    }
  }
});

test("explicit notes replacement confirms only the exact raw notes-only receipt", () => {
  const submitted = { rubric: { notes: "新评阅文字\n保留换行" } };
  const result = confirmTaskTemplateEditReceipt(
    "task-1",
    { ...receipt, rubric: { notes: "新评阅文字\n保留换行" } },
    submitted,
  );
  expect(result.kind).toBe("valid");
  if (result.kind !== "valid") throw new Error("Expected a confirmed receipt");
  expect(result.draft.rubricNotes).toBe("新评阅文字\n保留换行");
  for (const rubric of [
    undefined,
    null,
    {},
    [],
    { notes: 7 },
    { notes: "另一页的文字" },
    { notes: "  新评阅文字\n保留换行  " },
    { notes: "新评阅文字\n保留换行", scoring: { correctness: 70 } },
  ]) {
    expect(
      confirmTaskTemplateEditReceipt(
        "task-1",
        { ...receipt, rubric },
        submitted,
      ).kind,
    ).toBe("invalid");
  }
});

test("explicit rubric clear requires the raw empty object despite mapper folding", () => {
  const result = confirmTaskTemplateEditReceipt(
    "task-1",
    { ...receipt, rubric: {} },
    { rubric: {} },
  );
  expect(result.kind).toBe("valid");
  if (result.kind !== "valid") throw new Error("Expected a confirmed receipt");
  expect(result.task.rubric).toBeUndefined();
  expect(result.task.raw.rubric).toStrictEqual({});
  expect(result.draft.rubricNotes).toBe("");
  for (const rubric of [
    undefined,
    null,
    [],
    { notes: "" },
    { notes: 7 },
    { scoring: { correctness: 70 } },
  ]) {
    expect(
      confirmTaskTemplateEditReceipt(
        "task-1",
        { ...receipt, rubric },
        { rubric: {} },
      ).kind,
    ).toBe("invalid");
  }
});

test("publishing a clean draft adopts every server field as the new comparison baseline", () => {
  const reconciled = reconcileTaskTemplatePublishedDraft(
    baseline,
    { ...baseline },
    published,
  );
  expect(reconciled).toStrictEqual(published);
  expect(buildTaskTemplateEditRequest(published, reconciled)).toStrictEqual({
    kind: "unchanged",
  });
});

const unsavedFields: {
  field: keyof TaskTemplateEditDraft;
  value: string;
}[] = [
  { field: "title", value: "  本地未保存标题\n " },
  { field: "description", value: "  本地未保存描述\n    保留缩进\n\n" },
  { field: "knowledgeModule", value: " \n本地知识模块  " },
  { field: "courseLabel", value: "" },
  { field: "visibility", value: "SHARED" },
  { field: "difficulty", value: "" },
  { field: "rubricNotes", value: "  本地评阅文字\n内部保留  " },
  { field: "aiContextText", value: " [ ]\n" },
];
for (const { field, value } of unsavedFields) {
  test(`publishing preserves the unsaved ${field} input and synchronizes other fields`, () => {
    expect(
      reconcileTaskTemplatePublishedDraft(
        baseline,
        { ...baseline, [field]: value },
        published,
      ),
    ).toStrictEqual({ ...published, [field]: value });
  });
}

test("publishing preserves a local description draft while adopting another page's new title", () => {
  const reconciled = reconcileTaskTemplatePublishedDraft(
    baseline,
    { ...baseline, description: "  尚未保存第一行\n    第二行\n\n" },
    published,
  );
  expect(reconciled.title).toBe("发布时的远端标题");
  expect(reconciled.description).toBe("  尚未保存第一行\n    第二行\n\n");
  expect(buildTaskTemplateEditRequest(published, reconciled)).toStrictEqual({
    kind: "changed",
    payload: { description: "  尚未保存第一行\n    第二行\n\n" },
  });
});

test("publishing adopts server values after restored edits and equivalent formatting", () => {
  const original = { ...baseline, courseLabel: "" };
  const equivalent = {
    ...original,
    title: " \n原标题  ",
    knowledgeModule: "  原知识模块\n ",
    courseLabel: "未分类",
    rubricNotes: "旧评阅文字",
    aiContextText: JSON.stringify(refs, null, 4),
  };
  expect(
    reconcileTaskTemplatePublishedDraft(original, equivalent, published),
  ).toStrictEqual(published);
  const edited = {
    ...baseline,
    title: "曾经修改的标题",
    description: "曾经修改的描述",
    rubricNotes: "曾经修改的评阅文字",
    aiContextText: "[]",
  };
  const restored = { ...edited, ...baseline };
  expect(
    reconcileTaskTemplatePublishedDraft(baseline, restored, published),
  ).toStrictEqual(published);
});

test("a preserved local edit equivalent to the published baseline produces no PATCH", () => {
  const local = {
    ...published,
    title: "  发布时的远端标题\n ",
    knowledgeModule: " 发布时的知识模块 ",
    rubricNotes: " \n发布时的评阅文字  ",
    aiContextText: JSON.stringify(latestRefs),
  };
  const reconciled = reconcileTaskTemplatePublishedDraft(
    baseline,
    local,
    published,
  );
  expect(reconciled).toStrictEqual(local);
  expect(buildTaskTemplateEditRequest(published, reconciled)).toStrictEqual({
    kind: "unchanged",
  });
});

test("publishing preserves description whitespace changes and significant reference ordering", () => {
  const reordered = [
    refs[1],
    { ...refs[0], entryPaths: ["teacher/alternate.md", "teacher/guide.md"] },
  ];
  const local = {
    ...baseline,
    description: description + "\n",
    aiContextText: JSON.stringify(reordered, null, 4),
  };
  const reconciled = reconcileTaskTemplatePublishedDraft(
    baseline,
    local,
    published,
  );
  expect(reconciled).toStrictEqual({
    ...published,
    description: "  原文第一行\n    内部缩进\n末行\n\n\n",
    aiContextText: JSON.stringify(reordered, null, 4),
  });
  expect(buildTaskTemplateEditRequest(published, reconciled)).toStrictEqual({
    kind: "changed",
    payload: {
      description: "  原文第一行\n    内部缩进\n末行\n\n\n",
      aiContextRefs: reordered,
    },
  });
});

for (const field of ["title", "description", "knowledgeModule"] as const) {
  test(`publishing preserves temporarily blank ${field} without blocking other field synchronization`, () => {
    const reconciled = reconcileTaskTemplatePublishedDraft(
      baseline,
      { ...baseline, [field]: " \n\t " },
      published,
    );
    expect(reconciled).toStrictEqual({ ...published, [field]: " \n\t " });
    const request = buildTaskTemplateEditRequest(published, reconciled);
    expect(request.kind).toBe("invalid");
    if (request.kind === "invalid") expect(request.field).toBe(field);
  });
}

test("publishing preserves unfinished reference JSON and other invalid inputs independently", () => {
  for (const title of [baseline.title, " \n "]) {
    const reconciled = reconcileTaskTemplatePublishedDraft(
      baseline,
      { ...baseline, title, aiContextText: '[\n {"archivePath":' },
      published,
    );
    expect(reconciled).toStrictEqual({
      ...published,
      title: title === baseline.title ? "发布时的远端标题" : " \n ",
      aiContextText: '[\n {"archivePath":',
    });
    expect(buildTaskTemplateEditRequest(published, reconciled).kind).toBe(
      "invalid",
    );
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
