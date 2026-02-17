# Classrooms Module Notes

## Process Assessment (Z6)
- Endpoint:
  - `GET /api/classrooms/:classroomId/process-assessment`
  - `GET /api/classrooms/:classroomId/process-assessment.csv`
- Scope:
  - Enrollment-only members (`role=STUDENT`, `status=ACTIVE`)
  - Metrics isolated by `classroomId + classroomTaskId`

### v1 Rubric Constants
- `submittedTasksRate`: `0.4`
- `submissionsCount`: `0.2`
- `aiRequestQualityProxy`: `0.2`
- `codeQualityProxy`: `0.2`

### v1 Risk Thresholds
- `HIGH`: `submittedTasksRate < 0.4` or `avgErrorItems >= 3`
- `MEDIUM`: `submittedTasksRate < 0.7` or `avgErrorItems >= 1`
- `LOW`: otherwise

### Sorting Scope
- Page-local sorting only:
  - First page by stable Enrollment order (`userId` asc)
  - Then sort current page items by requested `sort/order`

### Important
- `score` is process-assessment reference only and must not be used as final grade arbitration.

## Deadline And Late Rules (Z7)
- `ClassroomTask.settings.allowLate` default: `true`
  - If omitted on publish, submissions are still allowed after `dueAt`.
- Submission write fields:
  - `submittedAt`: submission create time
  - `isLate`: `submittedAt > dueAt` when `dueAt` exists; otherwise `false`
  - `lateBySeconds`: `max(0, floor((submittedAt - dueAt)/1000))`
- Submission gate:
  - If `dueAt` exists and `allowLate === false` and `now > dueAt`, reject with code `LATE_SUBMISSION_NOT_ALLOWED`.
- Late metrics policy:
  - Dashboard/weekly/overview/trajectory/review-pack/process-assessment read late stats from persisted `submissions.isLate` / `submissions.lateBySeconds`.
  - In process-assessment v1, late metrics are display-only and do not directly change score/risk.
