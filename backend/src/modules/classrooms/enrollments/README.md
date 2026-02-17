# Enrollments Migration Notes

## AG Strategy
- `enrollments` is the only source of truth for:
  - membership authorization
  - `studentsCount` statistics
  - dashboard/report/overview membership-derived metrics
- Membership reads use only `role=STUDENT` and `status=ACTIVE`.

## Legacy `studentIds` Handling
- Join/remove still keep **dual-write** to `classrooms.studentIds` for output compatibility.
- `classrooms.studentIds` is non-authoritative and may lag; read paths must not use it for authorization or statistics.
- When APIs still expose `studentIds`, it is derived from active enrollments instead of classroom document storage.

## Removal Plan
- Remove dual-write and legacy `studentIds` response field once downstream clients no longer depend on it.
