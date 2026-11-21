import { expect, test } from "@playwright/test";
import {
  toClassroomDetailResponse,
  toClassroomEditDetailResponse,
  toClassroomListResponse,
  toClassroomSummary,
} from "../../lib/api/types-teacher";
import {
  buildClassroomEditPatch,
  toClassroomNameInputValue,
} from "../../lib/classroom-edit";

const classroomResponse = {
  id: "classroom-edit-contract",
  name: " 2026 秋-1 班 ",
  courseId: "course-classroom-edit-contract",
  teacherId: "teacher-classroom-edit-contract",
  joinCode: "CLASSROOM-EDIT",
  status: "ACTIVE",
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-21T08:00:00.000Z",
};

const baselineName =
  toClassroomEditDetailResponse(classroomResponse).name ?? "";

for (const wrapped of [false, true]) {
  test(`classroom edit detail preserves legal name whitespace (${wrapped ? "data envelope" : "direct response"})`, () => {
    const detail = toClassroomEditDetailResponse(
      wrapped ? { data: classroomResponse } : classroomResponse,
    );

    expect(detail.id).toBe("classroom-edit-contract");
    expect(detail.name).toBe(" 2026 秋-1 班 ");
    expect(toClassroomNameInputValue(detail.name ?? "")).toBe(" 2026 秋-1 班 ");
  });
}

test("classroom read-only detail, summary and list retain trimmed display names", () => {
  expect(toClassroomDetailResponse({ data: classroomResponse }).name).toBe(
    "2026 秋-1 班",
  );
  expect(toClassroomSummary(classroomResponse).name).toBe("2026 秋-1 班");
  expect(
    toClassroomListResponse({ items: [classroomResponse] }).items[0]?.name,
  ).toBe("2026 秋-1 班");
});

test("an untouched classroom name has no PATCH keys", () => {
  expect(
    buildClassroomEditPatch(
      baselineName,
      toClassroomNameInputValue(baselineName),
    ),
  ).toStrictEqual({});
});

test("a changed classroom name sends only name with its exact legal spaces", () => {
  expect(buildClassroomEditPatch(baselineName, " 2027 春-2 班 ")).toStrictEqual(
    { name: " 2027 春-2 班 " },
  );
});

test("restoring the opening classroom name removes the PATCH key", () => {
  expect(buildClassroomEditPatch(baselineName, "新班名")).toStrictEqual({
    name: "新班名",
  });
  expect(buildClassroomEditPatch(baselineName, " 2026 秋-1 班 ")).toStrictEqual(
    {},
  );
});

for (const { label, name, expected } of [
  {
    label: "adding",
    name: "  2026 秋-1 班  ",
    expected: { name: "  2026 秋-1 班  " },
  },
  {
    label: "removing",
    name: "2026 秋-1 班",
    expected: { name: "2026 秋-1 班" },
  },
]) {
  test(`${label} classroom name boundary spaces is a real edit`, () => {
    expect(buildClassroomEditPatch(baselineName, name)).toStrictEqual(expected);
  });
}

for (const name of ["", " \t\r\n"]) {
  test(`${name === "" ? "empty" : "whitespace-only"} classroom names are rejected`, () => {
    expect(buildClassroomEditPatch(baselineName, name)).toBeNull();
  });
}

const namesWithNewlines = [
  { label: "CR", name: " 2026\r 秋-1 班 " },
  { label: "LF", name: " 2026\n 秋-1 班 " },
  { label: "CRLF", name: " 2026\r\n 秋-1 班 " },
  { label: "mixed CR and LF", name: " 2026\r 秋\n-1\r\n 班 " },
];

for (const { label, name } of namesWithNewlines) {
  test(`an original name containing ${label} can be restored as visible single-line text without a PATCH`, () => {
    const detail = toClassroomEditDetailResponse({
      data: { ...classroomResponse, name },
    });
    const rawBaselineName = detail.name ?? "";
    const inputName = toClassroomNameInputValue(rawBaselineName);

    expect(detail.name).toBe(name);
    expect(inputName).toBe(" 2026 秋-1 班 ");
    expect(buildClassroomEditPatch(rawBaselineName, inputName)).toStrictEqual(
      {},
    );
    expect(
      buildClassroomEditPatch(rawBaselineName, " 2027 春-2 班 "),
    ).toStrictEqual({ name: " 2027 春-2 班 " });
    expect(
      buildClassroomEditPatch(rawBaselineName, " 2026 秋-1 班 "),
    ).toStrictEqual({});
  });
}

test("single-line comparison removes CR and LF without adding or collapsing spaces", () => {
  const detail = toClassroomEditDetailResponse({
    ...classroomResponse,
    name: " 一\r\n班  A\tB ",
  });
  const rawBaselineName = detail.name ?? "";

  expect(toClassroomNameInputValue(rawBaselineName)).toBe(" 一班  A\tB ");
  expect(
    buildClassroomEditPatch(rawBaselineName, " 一班  A\tB "),
  ).toStrictEqual({});
  expect(
    buildClassroomEditPatch(rawBaselineName, " 一 班  A\tB "),
  ).toStrictEqual({ name: " 一 班  A\tB " });
  expect(buildClassroomEditPatch(rawBaselineName, " 一班 A\tB ")).toStrictEqual(
    { name: " 一班 A\tB " },
  );
});
