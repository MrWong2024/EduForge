import { expect, test } from "@playwright/test";
import {
  buildClassroomTaskSettingsRequest,
  toClassroomTaskDueAtLocalValue,
  type ClassroomTaskSettingsDraft,
} from "../../lib/classroom-task-settings";

const originalTimeZone = process.env.TZ;
const baseline: ClassroomTaskSettingsDraft = {
  dueAtLocal: "2026-11-21T18:11",
  allowLate: true,
};
const changedLocalDueAt = "2026-11-22T09:43";

test.beforeAll(() => {
  process.env.TZ = "Asia/Shanghai";
});

test.afterAll(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

test("switch-only edit omits a deadline whose original instant includes seconds and milliseconds", () => {
  const dueAtLocal = toClassroomTaskDueAtLocalValue(
    "2026-11-21T10:11:37.456Z",
  );
  expect(dueAtLocal).toBe("2026-11-21T18:11");
  expect(
    buildClassroomTaskSettingsRequest(
      { dueAtLocal, allowLate: true },
      { dueAtLocal, allowLate: false },
    ),
  ).toStrictEqual({ kind: "changed", payload: { allowLate: false } });
});

test("date-only edit sends the new local minute as an ISO instant without allowLate", () => {
  expect(
    buildClassroomTaskSettingsRequest(baseline, {
      ...baseline,
      dueAtLocal: changedLocalDueAt,
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { dueAt: "2026-11-22T01:43:00.000Z" },
  });
});

test("explicitly clearing an existing deadline sends only null", () => {
  expect(
    buildClassroomTaskSettingsRequest(baseline, {
      ...baseline,
      dueAtLocal: "",
    }),
  ).toStrictEqual({ kind: "changed", payload: { dueAt: null } });
});

test("editing both settings includes both changed keys and preserves false", () => {
  expect(
    buildClassroomTaskSettingsRequest(baseline, {
      dueAtLocal: changedLocalDueAt,
      allowLate: false,
    }),
  ).toStrictEqual({
    kind: "changed",
    payload: { dueAt: "2026-11-22T01:43:00.000Z", allowLate: false },
  });
});

test("switch-only edit with no original deadline never adds dueAt", () => {
  expect(toClassroomTaskDueAtLocalValue(undefined)).toBe("");
  expect(
    buildClassroomTaskSettingsRequest(
      { dueAtLocal: "", allowLate: true },
      { dueAtLocal: "", allowLate: false },
    ),
  ).toStrictEqual({ kind: "changed", payload: { allowLate: false } });
});

test("untouched and restored drafts produce no request", () => {
  expect(buildClassroomTaskSettingsRequest(baseline, { ...baseline })).toStrictEqual(
    { kind: "unchanged" },
  );
  const edited = { dueAtLocal: changedLocalDueAt, allowLate: false };
  expect(buildClassroomTaskSettingsRequest(baseline, edited).kind).toBe("changed");
  expect(
    buildClassroomTaskSettingsRequest(baseline, {
      ...edited,
      dueAtLocal: baseline.dueAtLocal,
    }),
  ).toStrictEqual({ kind: "changed", payload: { allowLate: false } });
  const restored = { ...edited, ...baseline };
  expect(buildClassroomTaskSettingsRequest(baseline, restored)).toStrictEqual({
    kind: "unchanged",
  });
  expect(
    buildClassroomTaskSettingsRequest(
      { dueAtLocal: "", allowLate: false },
      { dueAtLocal: "", allowLate: false },
    ),
  ).toStrictEqual({ kind: "unchanged" });
});

for (const dueAtLocal of [
  "not-a-date",
  "2026-13-21T18:11",
  "2026-02-30T18:11",
  "2026-11-21T24:01",
  "   ",
]) {
  test(`invalid nonempty local date ${JSON.stringify(dueAtLocal)} refuses the whole request`, () => {
    expect(
      buildClassroomTaskSettingsRequest(baseline, {
        dueAtLocal,
        allowLate: false,
      }),
    ).toStrictEqual({ kind: "invalid-date" });
  });
}
