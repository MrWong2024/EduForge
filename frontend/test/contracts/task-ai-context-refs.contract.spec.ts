import { expect, test } from "@playwright/test";
import {
  buildAiContextRefsPatch,
  canEditTaskTemplate,
  formatAiContextRefs,
  isTaskTemplateAuthor,
  parseAiContextRefsJson,
} from "../../lib/learning-tasks/ai-context-refs";
import {
  toLearningTaskCreateResponse,
  toLearningTaskDetailResponse,
  toLearningTaskListResponse,
  toLearningTaskUpdateResponse,
} from "../../lib/api/types-teacher";

const refs = [
  {
    archivePath: "教材/教师 C++.zip",
    entryPaths: ["正文/说明.md", "src/C++.hpp"],
  },
  { archivePath: "教材/学生.zip", entryPaths: ["work/demo.cpp"] },
];

test("teacher template response adapters retain exact paths and configured order", () => {
  const payload = { id: "task", aiContextRefs: refs };
  for (const adapt of [
    toLearningTaskDetailResponse,
    toLearningTaskCreateResponse,
    toLearningTaskUpdateResponse,
  ]) {
    expect(adapt(payload).aiContextRefs).toEqual(refs);
    expect(adapt({ data: payload }).aiContextRefs).toEqual(refs);
    expect(adapt({ id: "legacy" }).aiContextRefs).toBeUndefined();
    expect(adapt({ aiContextRefs: [] }).aiContextRefs).toEqual([]);
    for (const invalid of [null, {}, [{ ...refs[0], entryPaths: null }]]) {
      expect(() => adapt({ aiContextRefs: invalid })).toThrow();
    }
  }
  expect(
    toLearningTaskListResponse({ items: [payload], total: 1 }).items[0]
      .aiContextRefs,
  ).toEqual(refs);
});

test("accepts arrays including explicit empty configuration", () => {
  expect(parseAiContextRefsJson(JSON.stringify(refs))).toEqual(refs);
  expect(parseAiContextRefsJson(" [] \n")).toEqual([]);
});

for (const [label, text] of [
  ["blank", " \n\t"],
  ["syntax", "[{]"],
  ["null", "null"],
  ["object", "{}"],
  ["string", '"refs"'],
  ["number", "1"],
  ["boolean", "false"],
  ["null item", "[null]"],
  ["array item", "[[]]"],
  ["missing archive", '[{"entryPaths":["a.md"]}]'],
  ["wrong archive", '[{"archivePath":1,"entryPaths":["a.md"]}]'],
  ["missing entries", '[{"archivePath":"a.zip"}]'],
  ["empty entries", '[{"archivePath":"a.zip","entryPaths":[]}]'],
  ["wrong entry type", '[{"archivePath":"a.zip","entryPaths":[1]}]'],
  ["empty entry", '[{"archivePath":"a.zip","entryPaths":[""]}]'],
  [
    "unknown key",
    '[{"archivePath":"a.zip","entryPaths":["a.md"],"language":"cpp"}]',
  ],
] as const) {
  test(`rejects ${label} without turning errors into empty references`, () => {
    expect(() => parseAiContextRefsJson(text)).toThrow(/[\u4e00-\u9fff]/);
    expect(() => buildAiContextRefsPatch(text, refs)).toThrow();
  });
}

test("does not normalize paths or infer backend validity", () => {
  const exact = [
    {
      archivePath: " 教材\\C++.ZIP ",
      entryPaths: [" ./正文.md ", "work/../x.cpp"],
    },
  ];
  expect(parseAiContextRefsJson(JSON.stringify(exact))).toEqual(exact);
});

test("omits unchanged references despite indentation and object property order", () => {
  const text =
    '[{"entryPaths":["正文/说明.md","src/C++.hpp"],"archivePath":"教材/教师 C++.zip"},{"entryPaths":["work/demo.cpp"],"archivePath":"教材/学生.zip"}]';
  expect(buildAiContextRefsPatch(text, refs)).toEqual({});
  expect(buildAiContextRefsPatch(formatAiContextRefs(refs), refs)).toEqual({});
  expect(buildAiContextRefsPatch("[]", [])).toEqual({});
});

test("sends the full modified configuration and explicit clear, preserving significant array order", () => {
  const next = [
    refs[1],
    { ...refs[0], entryPaths: ["src/C++.hpp", "正文/说明.md"] },
  ];
  expect(buildAiContextRefsPatch(JSON.stringify(next), refs)).toEqual({
    aiContextRefs: next,
  });
  expect(buildAiContextRefsPatch("[]", refs)).toEqual({ aiContextRefs: [] });
});

test("the successful response is the next baseline; subsequent unrelated saves omit references", () => {
  const saved = toLearningTaskUpdateResponse({
    id: "task",
    aiContextRefs: [refs[1]],
  });
  expect(buildAiContextRefsPatch(JSON.stringify([refs[1]]), refs)).toEqual({
    aiContextRefs: [refs[1]],
  });
  expect(
    buildAiContextRefsPatch(
      JSON.stringify([refs[1]]),
      saved.aiContextRefs ?? [],
    ),
  ).toEqual({});
});

test("editing requires known identity, exact author match and a mutable template status", () => {
  for (const status of ["DRAFT", "PUBLISHED"])
    expect(canEditTaskTemplate("a", "a", status)).toBe(true);
  for (const [user, owner, status] of [
    [undefined, "a", "DRAFT"],
    ["a", undefined, "DRAFT"],
    ["", "", "DRAFT"],
    ["a", "b", "PUBLISHED"],
    ["a", "a", "ARCHIVED"],
    ["a", "a", undefined],
    ["a", "a", "UNKNOWN"],
    [" ", " ", "DRAFT"],
  ])
    expect(canEditTaskTemplate(user, owner, status)).toBe(false);
});

test("an archived author remains identifiable while editing is forbidden", () => {
  expect(isTaskTemplateAuthor("author", "author")).toBe(true);
  expect(canEditTaskTemplate("author", "author", "ARCHIVED")).toBe(false);
  expect(isTaskTemplateAuthor(undefined, "author")).toBe(false);
});
