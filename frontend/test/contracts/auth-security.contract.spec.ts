import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET as proxyGet, POST as proxyPost } from "../../app/api/proxy/[...path]/route";
import {
  BrowserFetchJsonError,
  createPageFetch,
  fetchJson,
  isDefiniteCreateRejection,
} from "../../lib/api/browser-client";
import { getAuthError } from "../../lib/auth/auth-errors";
import {
  validateNewPassword,
  validatePassword,
} from "../../lib/auth/password-policy";
import { getSafeNextPath } from "../../lib/auth/safe-next";
import { getFrontendOrigin } from "../../lib/http/frontend-origin";

const pageAccountA = "000000000000000000000001";
const pageAccountB = "000000000000000000000002";
const pageAccountHeader = "x-expected-user-id";

test("protected writes take their expected identity from the page scope", async () => {
  const originalFetch = globalThis.fetch;
  const sent: Array<{ path: string; method?: string; userId: string | null }> = [];
  let currentUserId = pageAccountA;
  globalThis.fetch = async (path, options) => {
    sent.push({
      path: String(path),
      method: options?.method,
      userId: new Headers(options?.headers).get(pageAccountHeader),
    });
    return Response.json({ ok: true, id: currentUserId });
  };
  try {
    const scope = {
      expectedUserId: pageAccountA,
      capture: () => () => true,
      canWrite: () => true,
      onMismatch: () => { throw new Error("unexpected mismatch"); },
      onUnconfirmedSuccess: () => { throw new Error("unexpected unconfirmed success"); },
    };
    const samePage = createPageFetch(scope);
    const nextAccountPage = createPageFetch({ ...scope, expectedUserId: pageAccountB });
    await samePage("courses", {
      method: "POST",
      headers: { [pageAccountHeader]: pageAccountB },
    });
    await samePage("learning-tasks/submissions/fixture", { method: "PATCH" });
    currentUserId = pageAccountB;
    await nextAccountPage("classrooms/join", { method: "POST" });
    await samePage("users/me");
    for (const entry of ["login", "forgot-password", "reset-password", "logout"]) {
      await fetchJson(`auth/${entry}`, { method: "POST" });
    }
    await expect(fetchJson("courses", { method: "POST" })).rejects.toThrow(
      "无法确认此页面的账号",
    );
    await expect(
      createPageFetch({ ...scope, expectedUserId: "" })("users/me/change-password", {
        method: "POST",
      }),
    ).rejects.toThrow("无法确认此页面的账号");
    expect(sent).toEqual([
      { path: "/api/proxy/courses", method: "POST", userId: pageAccountA },
      { path: "/api/proxy/users/me", userId: null },
      { path: "/api/proxy/learning-tasks/submissions/fixture", method: "PATCH", userId: pageAccountA },
      { path: "/api/proxy/users/me", userId: null },
      { path: "/api/proxy/classrooms/join", method: "POST", userId: pageAccountB },
      { path: "/api/proxy/users/me", userId: null },
      { path: "/api/proxy/users/me", userId: null },
      ...["login", "forgot-password", "reset-password", "logout"].map((entry) => ({
        path: `/api/proxy/auth/${entry}`, method: "POST", userId: null,
      })),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only a confirmed account mismatch closes the page scope", async () => {
  const originalFetch = globalThis.fetch;
  let mismatches = 0;
  const client = createPageFetch({
    expectedUserId: pageAccountA,
    capture: () => () => true,
    canWrite: () => true,
    onMismatch: () => { mismatches += 1; },
    onUnconfirmedSuccess: () => { throw new Error("unexpected unconfirmed success"); },
  });
  const write = () => client("courses", { method: "POST" });
  try {
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    await expect(write()).rejects.toThrow("network unavailable");

    globalThis.fetch = async () =>
      Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    await expect(write()).rejects.toMatchObject({ status: 401 });
    globalThis.fetch = async () =>
      Response.json({ code: "REVISION_CONFLICT" }, { status: 409 });
    await expect(write()).rejects.toMatchObject({
      status: 409,
      data: { code: "REVISION_CONFLICT" },
    });
    expect(mismatches).toBe(0);

    globalThis.fetch = async () =>
      Response.json({ code: "PAGE_ACCOUNT_MISMATCH" }, { status: 409 });
    await expect(write()).rejects.toMatchObject({
      status: 409,
      data: { code: "PAGE_ACCOUNT_MISMATCH" },
    });
    expect(mismatches).toBe(1);
    expect(
      isDefiniteCreateRejection(
        new BrowserFetchJsonError(409, { code: "PAGE_ACCOUNT_MISMATCH" }),
      ),
    ).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a response cannot complete UI work after its page scope ends", async () => {
  const originalFetch = globalThis.fetch;
  const response = Promise.withResolvers<Response>();
  let live = true;
  let writes = 0;
  globalThis.fetch = () => {
    writes += 1;
    return response.promise;
  };
  try {
    const client = createPageFetch({
      expectedUserId: pageAccountA,
      capture: () => () => live,
      canWrite: () => true,
      onMismatch: () => { throw new Error("unexpected mismatch"); },
      onUnconfirmedSuccess: () => { throw new Error("unexpected unconfirmed success"); },
    });
    const started = client("courses", { method: "POST" });
    expect(writes).toBe(1);
    live = false;
    response.resolve(Response.json({ id: "created-for-original-account" }));
    await expect(started).rejects.toThrow("请重新打开页面");
    await expect(client("courses", { method: "POST" })).rejects.toThrow(
      "请重新打开页面",
    );
    expect(writes).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a delayed success is withheld if the browser account changed or is temporarily unconfirmed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const result of ["different-account", "unavailable"] as const) {
      const response = Promise.withResolvers<Response>();
      let live = true;
      let canWrite = true;
      let writeCount = 0;
      let identities = 0;
      globalThis.fetch = (path, options) => {
        if (path === "/api/proxy/users/me") {
          identities += 1;
          expect(options?.cache).toBe("no-store");
          expect(options?.signal).toBeInstanceOf(AbortSignal);
          return Promise.resolve(
            result === "different-account"
              ? Response.json({ id: pageAccountB })
              : Response.json({}, { status: 401 }),
          );
        }
        writeCount += 1;
        return response.promise;
      };
      const client = createPageFetch({
        expectedUserId: pageAccountA,
        capture: () => () => live,
        canWrite: () => canWrite,
        onMismatch: () => { live = false; },
        onUnconfirmedSuccess: () => { canWrite = false; },
      });
      const write = () => client("courses", { method: "POST" });
      const delayed = write();
      expect(writeCount).toBe(1);
      expect(identities).toBe(0);
      response.resolve(Response.json({ id: "already-created" }, { status: 201 }));
      if (result === "different-account") {
        await expect(delayed).rejects.toMatchObject({
          status: 409,
          data: { code: "PAGE_ACCOUNT_MISMATCH" },
        });
        expect(live).toBe(false);
        expect(canWrite).toBe(true);
      } else {
        await expect(delayed).rejects.toThrow(
          "操作已收到成功回执，暂时无法确认当前账号，请先核对结果。",
        );
        expect(live).toBe(true);
        expect(canWrite).toBe(false);
      }
      await expect(write()).rejects.toThrow();
      expect(writeCount).toBe(1);
      expect(identities).toBe(1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF forwards only the expected account on protected writes and preserves authentication results", async () => {
  const originalFetch = globalThis.fetch;
  const originalOrigin = process.env.FRONTEND_BACKEND_ORIGIN;
  const sent: Array<{ userId: string | null; unrelated: string | null }> = [];
  process.env.FRONTEND_BACKEND_ORIGIN = "http://127.0.0.1:4000";
  globalThis.fetch = async (_path, options) => {
    const headers = new Headers(options?.headers);
    sent.push({
      userId: headers.get(pageAccountHeader),
      unrelated: headers.get("x-unrelated"),
    });
    return Response.json({ statusCode: 401 }, { status: 401 });
  };
  const dispatch = (path: string, requestMethod: "POST" | "GET", account?: string) => {
    const headers = new Headers({ "x-unrelated": "discard" });
    if (account) headers.set(pageAccountHeader, account);
    const handler = requestMethod === "POST" ? proxyPost : proxyGet;
    return handler(
      new NextRequest(`http://localhost:3000/api/proxy/${path}`, {
        method: requestMethod,
        headers,
      }),
      { params: Promise.resolve({ path: path.split("/") }) },
    );
  };
  try {
    expect((await dispatch("courses", "POST", pageAccountA)).status).toBe(401);
    expect((await dispatch("courses", "POST")).status).toBe(401);
    await dispatch("auth/logout", "POST", pageAccountA);
    await dispatch("users/me", "GET", pageAccountA);
    expect(sent).toEqual([
      { userId: pageAccountA, unrelated: null },
      { userId: "", unrelated: null },
      { userId: null, unrelated: null },
      { userId: null, unrelated: null },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.FRONTEND_BACKEND_ORIGIN;
    else process.env.FRONTEND_BACKEND_ORIGIN = originalOrigin;
  }
});

// Expected boundaries come from this batch's locked security contract and the
// Backend DTO Cheatsheet, not from parsing production source or its outputs.
test("FRONTEND_URL defaults only when absent and accepts HTTP(S) origins", () => {
  expect(getFrontendOrigin(undefined)).toBe("http://localhost:3000");
  expect(getFrontendOrigin("http://127.0.0.1:3100")).toBe(
    "http://127.0.0.1:3100",
  );
  expect(getFrontendOrigin("https://school.example/")).toBe(
    "https://school.example",
  );
  expect(getFrontendOrigin("HTTPS://SCHOOL.EXAMPLE:443/")).toBe(
    "https://school.example",
  );
  expect(getFrontendOrigin("http://[::1]:3100/")).toBe("http://[::1]:3100");
});

test("FRONTEND_URL rejects empty or non-origin configuration without echoing it", () => {
  for (const value of [
    "",
    "   ",
    "school.example",
    "//school.example",
    "ftp://school.example",
    "https://private-user:private-password@school.example",
    "https://school.example/teacher",
    "https://school.example?private-query=1",
    "https://school.example?",
    "https://school.example#private-fragment",
    "https://school.example#",
    "https://@school.example",
    "https://school.example\\teacher",
    "https://school.example\n",
    "http://[invalid",
  ]) {
    let error: unknown;
    try {
      getFrontendOrigin(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    if (value.trim()) {
      expect((error as Error).message).not.toContain(value);
    }
  }
});

test("safe next retains local query/hash and returns an idempotent normalized path", () => {
  for (const [input, expected] of [
    ["/", "/"],
    [
      "/teacher/account?tab=password#form",
      "/teacher/account?tab=password#form",
    ],
    [
      "/student/../student/account?q=a%2Fb#saved",
      "/student/account?q=a%2Fb#saved",
    ],
    [
      "/teacher/account?next=https://example.org#https://example.org",
      "/teacher/account?next=https://example.org#https://example.org",
    ],
    ["/%252e%252e/teacher", "/%252e%252e/teacher"],
  ]) {
    const result = getSafeNextPath(input);
    expect(result).toBe(expected);
    expect(getSafeNextPath(result)).toBe(expected);
  }
});

test("safe next rejects external, ambiguous and control-character destinations", () => {
  for (const value of [
    null,
    "",
    " ",
    "teacher/account",
    "https://evil.example/path",
    "http://evil.example",
    "javascript:alert(1)",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/teacher\\account",
    "/teacher\u0000account",
    "/teacher\taccount",
    "/teacher\naccount",
    "/teacher\raccount",
    "/teacher\u001faccount",
    "/teacher\u007faccount",
    "/a/..//evil.example",
    "/a/%2e%2e//evil.example",
    "/a/.%2e//evil.example",
    "/a/%2e.//evil.example",
  ]) {
    expect(getSafeNextPath(value)).toBeNull();
  }
});

test("password minimums use Unicode code points for each operation", () => {
  expect(validatePassword("abcde", "login").error).not.toBeNull();
  expect(validatePassword("abcdef", "login").error).toBeNull();
  expect(validatePassword("", "current").error).not.toBeNull();
  expect(validatePassword("😀", "current").error).toBeNull();
  for (const unit of ["a", "汉", "😀"]) {
    expect(validatePassword(unit.repeat(7), "new").error).not.toBeNull();
    expect(validatePassword(unit.repeat(8), "new").error).toBeNull();
  }
  expect(validatePassword("😀".repeat(5), "login").error).not.toBeNull();
  expect(validatePassword("😀".repeat(6), "login").error).toBeNull();
});

test("all password kinds enforce 72 UTF-8 bytes without truncation", () => {
  for (const kind of ["login", "current", "new"] as const) {
    for (const valid of ["a".repeat(72), "汉".repeat(24), "😀".repeat(18)]) {
      expect(validatePassword(valid, kind)).toEqual({
        value: valid,
        error: null,
      });
    }
    for (const invalid of ["a".repeat(73), "汉".repeat(25), "😀".repeat(19)]) {
      const result = validatePassword(invalid, kind);
      expect(result.value).toBe(invalid);
      expect(result.error).not.toBeNull();
    }
  }
});

test("login/current preserve source text while new password and confirmation trim", () => {
  expect(validatePassword(" abcde", "login")).toEqual({
    value: " abcde",
    error: null,
  });
  expect(validatePassword(" ", "current")).toEqual({ value: " ", error: null });
  expect(validatePassword("  abcdefgh  ", "new")).toEqual({
    value: "abcdefgh",
    error: null,
  });
  expect(validatePassword(` ${"a".repeat(72)} `, "new")).toEqual({
    value: "a".repeat(72),
    error: null,
  });
  for (const kind of ["login", "current"] as const) {
    const source = ` ${"a".repeat(72)}`;
    expect(validatePassword(source, kind).value).toBe(source);
    expect(validatePassword(source, kind).error).not.toBeNull();
  }
  expect(validateNewPassword("  abcdefgh  ", "\tabcdefgh\n")).toEqual({
    value: "abcdefgh",
    error: null,
  });
  expect(validateNewPassword("abcdefgh", "abcdefgX").error).not.toBeNull();
  expect(
    validateNewPassword("abcdefgh", "abcdefgh", "abcdefgh").error,
  ).not.toBeNull();
  expect(
    validateNewPassword("abcdefgh", "abcdefgh", " abcdefgh ").error,
  ).toBeNull();
});

test("only status 400 plus a root stable code selects password or reset-token errors", () => {
  for (const operation of ["login", "reset", "change"] as const) {
    const policy = getAuthError(
      new BrowserFetchJsonError(400, { code: "PASSWORD_POLICY_VIOLATION" }),
      operation,
    );
    expect(policy.summary).toMatch(/密码/);
    expect(policy.summary).toContain("72");
    expect(policy.summary).toContain(operation === "login" ? "6" : "8");
    expect(policy.summary).not.toContain("PASSWORD_POLICY_VIOLATION");
  }
  const reset = getAuthError(
    new BrowserFetchJsonError(400, { code: "RESET_TOKEN_INVALID" }),
    "reset",
  );
  expect(reset.summary).toMatch(/链接/);
  expect(reset.summary).toMatch(/无效|过期/);
  expect(reset.recovery).toBe("reset");

  const ordinary = getAuthError(new BrowserFetchJsonError(400, {}), "reset");
  expect(ordinary.summary).not.toMatch(/链接.*(?:无效|过期)/);
  for (const data of [
    { error: { code: "RESET_TOKEN_INVALID" } },
    { data: { code: "RESET_TOKEN_INVALID" } },
    { errorCode: "RESET_TOKEN_INVALID" },
    { message: "Reset token is invalid" },
    "RESET_TOKEN_INVALID",
  ]) {
    expect(getAuthError(new BrowserFetchJsonError(400, data), "reset")).toEqual(
      ordinary,
    );
  }
  expect(
    getAuthError(
      new BrowserFetchJsonError(403, { code: "RESET_TOKEN_INVALID" }),
      "reset",
    ).recovery,
  ).not.toBe("reset");
});

test("401 preserves safe login and changed-credential recovery boundaries", () => {
  const login = getAuthError(new BrowserFetchJsonError(401, {}), "login");
  expect(login.summary).toMatch(/账号.*密码|邮箱.*密码/);
  expect(login.summary).not.toMatch(/停用|不存在|禁用/);
  const change = getAuthError(new BrowserFetchJsonError(401, {}), "change");
  expect(change.summary).toMatch(/当前密码/);
  expect(change.summary).toMatch(/会话|凭据/);
  expect(change.recovery).toBe("login");
  expect(change.summary).not.toMatch(/未修改|没有修改|没有改变/);
});

test("network/server failures and a post-login probe preserve uncertain outcomes", () => {
  for (const error of [
    new TypeError("private-network-detail"),
    new BrowserFetchJsonError(503, {}),
  ]) {
    for (const operation of ["reset", "change"] as const) {
      const result = getAuthError(error, operation);
      expect(result.summary).toMatch(/确认/);
      expect(result.summary).toMatch(/新密码登录/);
      expect(result.summary).not.toMatch(/未修改|没有修改|没有改变/);
      expect(result.recovery).toBeTruthy();
    }
    const login = getAuthError(error, "login");
    expect(login.summary).toMatch(/确认|核对/);
    expect(login.recovery).toBe("check-login");
  }
  const probe = getAuthError(new BrowserFetchJsonError(401, {}), "login-probe");
  expect(probe.summary).toMatch(/登录状态/);
  expect(probe.summary).toMatch(/确认/);
  expect(probe.summary).not.toMatch(/账号或密码错误/);
  expect(probe.recovery).toBe("check-login");
});

test("all public auth errors hide raw payloads, messages, codes and stack details", () => {
  for (const operation of [
    "login",
    "forgot",
    "reset",
    "change",
    "login-probe",
  ] as const) {
    for (const status of [400, 401, 403, 404, 500]) {
      const result = getAuthError(
        new BrowserFetchJsonError(
          status,
          {
            message: "private-backend-message",
            body: "private-body",
            code: "private-code",
            stack: "private-stack",
          },
          "private-error-message",
        ),
        operation,
      );
      expect(result.summary).toBeTruthy();
      expect(result.summary).not.toMatch(/private-/);
    }
    expect(
      getAuthError(new Error("private-plain-error"), operation).summary,
    ).not.toContain("private-");
  }
});
