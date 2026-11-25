import { paths } from "./routes/paths";
import { buildQueryString, parseEnum } from "./ui/format";

export const SNAPSHOT_WINDOWS = ["7d", "30d", "term"] as const;

type SnapshotSearchValue = string | readonly string[] | undefined;

export type SnapshotSearchParams = {
  window?: SnapshotSearchValue;
  includePerTask?: SnapshotSearchValue;
  limitStudents?: SnapshotSearchValue;
  limitAssessment?: SnapshotSearchValue;
};

export type SnapshotQueryState = {
  window: (typeof SNAPSHOT_WINDOWS)[number];
  includePerTask: boolean;
  limitStudents: number;
  limitAssessment: number;
};

const parseSnapshotLimit = (value: SnapshotSearchValue): number => {
  const limit = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : 200;
};

export const resolveSnapshotQuery = ({
  window,
  includePerTask,
  limitStudents,
  limitAssessment,
}: SnapshotSearchParams): SnapshotQueryState => ({
  window: parseEnum(
    typeof window === "string" ? window : undefined,
    SNAPSHOT_WINDOWS,
    "term",
  ),
  includePerTask: includePerTask !== "false" && includePerTask !== "1" && includePerTask !== "0",
  limitStudents: parseSnapshotLimit(limitStudents),
  limitAssessment: parseSnapshotLimit(limitAssessment),
});

export const buildSnapshotApiPath = (
  classroomId: string,
  query: SnapshotQueryState,
): string =>
  `classrooms/${encodeURIComponent(classroomId)}/export/snapshot?${buildQueryString(query)}`;

export const buildSnapshotHref = (
  classroomId: string,
  current: SnapshotQueryState,
  next: Partial<SnapshotQueryState>,
): string =>
  `${paths.teacher.classroomExportSnapshot(classroomId)}?${buildQueryString({ ...current, ...next })}`;
