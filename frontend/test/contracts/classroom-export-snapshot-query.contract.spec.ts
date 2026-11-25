import { expect, test } from "@playwright/test";
import {
  buildSnapshotApiPath,
  buildSnapshotHref,
  resolveSnapshotQuery,
  SNAPSHOT_WINDOWS,
} from "../../lib/classroom-export-snapshot-query";

test("snapshot defaults to term, 200 rows per section, and per-task detail", () => {
  const query = resolveSnapshotQuery({});

  expect(SNAPSHOT_WINDOWS).toEqual(["7d", "30d", "term"]);
  expect(query).toEqual({
    window: "term",
    includePerTask: true,
    limitStudents: 200,
    limitAssessment: 200,
  });
  expect(buildSnapshotApiPath("class/a", query)).toBe(
    "classrooms/class%2Fa/export/snapshot?window=term&includePerTask=true&limitStudents=200&limitAssessment=200",
  );
});

test("snapshot limits accept nonpreset values and both inclusive boundaries", () => {
  expect(
    resolveSnapshotQuery({ window: "7d", limitStudents: "1", limitAssessment: "1000" }),
  ).toEqual({ window: "7d", includePerTask: true, limitStudents: 1, limitAssessment: 1000 });
  expect(
    resolveSnapshotQuery({ window: "30d", limitStudents: "1000", limitAssessment: "700" }),
  ).toEqual({ window: "30d", includePerTask: true, limitStudents: 1000, limitAssessment: 700 });
  expect(
    buildSnapshotApiPath(
      "class-id",
      resolveSnapshotQuery({ window: "term", limitStudents: "700", limitAssessment: "1" }),
    ),
  ).toBe(
    "classrooms/class-id/export/snapshot?window=term&includePerTask=true&limitStudents=700&limitAssessment=1",
  );
});

test("snapshot replaces an old or invalid window and defaults each invalid limit independently", () => {
  for (const window of ["24h", "all", "invalid", ["7d", "30d"]]) {
    expect(resolveSnapshotQuery({ window, limitStudents: "700", limitAssessment: "1" })).toEqual({
      window: "term",
      includePerTask: true,
      limitStudents: 700,
      limitAssessment: 1,
    });
  }
  for (const limit of ["0", "1001", "1.5", "20rows", "", ["1", "2"]]) {
    expect(
      resolveSnapshotQuery({ window: "7d", limitStudents: limit, limitAssessment: "1" }),
    ).toEqual({ window: "7d", includePerTask: true, limitStudents: 200, limitAssessment: 1 });
    expect(
      resolveSnapshotQuery({ window: "30d", limitStudents: "700", limitAssessment: limit }),
    ).toEqual({ window: "30d", includePerTask: true, limitStudents: 700, limitAssessment: 200 });
  }
});

test("snapshot normalizes BooleanString inputs to the service's per-task behavior", () => {
  expect(resolveSnapshotQuery({ includePerTask: "true" }).includePerTask).toBe(true);
  expect(resolveSnapshotQuery({ includePerTask: "invalid" }).includePerTask).toBe(true);

  for (const includePerTask of ["false", "1", "0"]) {
    const query = resolveSnapshotQuery({ includePerTask });
    expect(query.includePerTask).toBe(false);
    expect(buildSnapshotApiPath("class-id", query)).toBe(
      "classrooms/class-id/export/snapshot?window=term&includePerTask=false&limitStudents=200&limitAssessment=200",
    );
  }
});

test("snapshot links preserve nonpreset limits through detail and window changes", () => {
  const query = resolveSnapshotQuery({ window: "term", limitStudents: "700", limitAssessment: "1" });

  expect(buildSnapshotHref("class-id", query, { includePerTask: false })).toBe(
    "/teacher/classrooms/class-id/export/snapshot?window=term&includePerTask=false&limitStudents=700&limitAssessment=1",
  );
  const withoutDetail = resolveSnapshotQuery({
    window: "term",
    includePerTask: "false",
    limitStudents: "700",
    limitAssessment: "1",
  });
  expect(buildSnapshotHref("class-id", withoutDetail, { window: "7d" })).toBe(
    "/teacher/classrooms/class-id/export/snapshot?window=7d&includePerTask=false&limitStudents=700&limitAssessment=1",
  );
  expect(buildSnapshotHref("class-id", withoutDetail, { includePerTask: true })).toBe(
    "/teacher/classrooms/class-id/export/snapshot?window=term&includePerTask=true&limitStudents=700&limitAssessment=1",
  );
});
