import { expect, test } from "@playwright/test";
import {
  normalizeJoinCodeInput,
  submitJoinClassroom,
} from "../../components/student/JoinClassroomForm";
import { BrowserFetchJsonError } from "../../lib/api/browser-client";

const invalidCodeSummary = "加入码无效或班级不存在，请检查后重试。";
const archivedSummary = "该班级已归档，暂时无法加入。请联系任课教师确认。";

function captureJoinRequest(error?: Error) {
  const calls: {
    path: string;
    method: RequestInit["method"];
    body: RequestInit["body"];
  }[] = [];
  const request = async (path: string, init: RequestInit) => {
    calls.push({ path, method: init.method, body: init.body });
    if (error) throw error;
  };
  return { calls, request };
}

test("the displayed code is uppercased and submitted once with only its edges trimmed", async () => {
  for (const [input, displayed] of [
    ["abcd12", "ABCD12"],
    ["  aBcD12  ", "  ABCD12  "],
    ["ABCD12", "ABCD12"],
  ]) {
    const { request, calls } = captureJoinRequest();
    const value = normalizeJoinCodeInput(input);

    expect(value).toBe(displayed);
    expect(await submitJoinClassroom(value, request)).toBeNull();
    expect(calls).toEqual([
      { path: "classrooms/join", method: "POST", body: '{"joinCode":"ABCD12"}' },
    ]);
  }
});

test("whitespace-only input shows validation without a request", async () => {
  const { request, calls } = captureJoinRequest();

  expect(await submitJoinClassroom(" \t  ", request)).toMatchObject({
    summary: "请输入班级加入码后再提交。",
  });
  expect(calls).toHaveLength(0);
});

test("interior spaces and characters outside ASCII lowercase stay in the request", async () => {
  const { request, calls } = captureJoinRequest(
    new BrowserFetchJsonError(400, { message: "Invalid join code" }),
  );
  const value = normalizeJoinCodeInput(" aBßñｃ  d12 ");

  expect(value).toBe(" ABßñｃ  D12 ");
  expect(await submitJoinClassroom(value, request)).toMatchObject({
    status: 400,
    summary: invalidCodeSummary,
  });
  expect(calls).toEqual([
    {
      path: "classrooms/join",
      method: "POST",
      body: '{"joinCode":"ABßñｃ  D12"}',
    },
  ]);
});

test("only an exact archived message with HTTP 400 gives the archived summary", async () => {
  for (const [status, message, summary] of [
    [400, "Classroom is archived", archivedSummary],
    [400, "Classroom is archived ", invalidCodeSummary],
    [400, "Bad request", invalidCodeSummary],
    [404, "Classroom is archived", invalidCodeSummary],
  ] as const) {
    const { request, calls } = captureJoinRequest(
      new BrowserFetchJsonError(status, { message }),
    );

    expect(await submitJoinClassroom("ARCV21", request)).toMatchObject({
      status,
      summary,
    });
    expect(calls).toHaveLength(1);
  }
});

test("permission and network errors retain their usual summaries without a retry", async () => {
  for (const [error, summary] of [
    [
      new BrowserFetchJsonError(403, { message: "Forbidden" }),
      "当前账号无权限加入该班级。",
    ],
    [new TypeError("Failed to fetch"), "加入班级请求失败，请稍后重试。"],
  ] as const) {
    const { request, calls } = captureJoinRequest(error);
    expect(await submitJoinClassroom("ABCD12", request)).toMatchObject({
      summary,
    });
    expect(calls).toHaveLength(1);
  }
});
