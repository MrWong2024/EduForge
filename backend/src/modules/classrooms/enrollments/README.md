# Enrollments Migration Notes

## AD Strategy
- Current migration mode is **dual-write**:
  - write `enrollments` as source of truth
  - keep `classrooms.studentIds` synchronized as legacy mirror
- This preserves backward compatibility during rollout and avoids breaking old readers.

## Legacy Fallback (Temporary)
- Readers should prefer `enrollments` (`role=STUDENT`, `status=ACTIVE`).
- Fallback to `classrooms.studentIds` is allowed **only when**:
  - a classroom has zero enrollment records (`enrollments` empty for that classroom), and
  - `classrooms.studentIds` is non-empty.

## Removal Plan
- Remove dual-write and legacy fallback after enrollment backfill is complete and all membership/stats readers are migrated to `enrollments` only (planned in AE/AF follow-up).
