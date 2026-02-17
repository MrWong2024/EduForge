# Classroom Pilot Runbook

## 1. Quick Start (10 Minutes)

### 1.1 Environment Prep
- Required: `MONGO_URI`
- Recommended for pilot demo (safe, deterministic):
  - `NODE_ENV=development`
  - `AI_FEEDBACK_PROVIDER=stub`
  - `AI_FEEDBACK_REAL_ENABLED=false`
  - `AI_FEEDBACK_DEBUG_ENABLED=true` (to use debug ops endpoints)
  - `AI_FEEDBACK_WORKER_ENABLED=false` (manual control with `process-once`)

### 1.2 Start Backend
- Start backend normally (global prefix is `/api`).

### 1.3 End-to-End Path
1. Teacher login: `POST /api/auth/login`
2. Create course: `POST /api/courses`
3. Create classroom: `POST /api/classrooms`
4. Create/publish task:
   - `POST /api/learning-tasks/tasks`
   - `POST /api/learning-tasks/tasks/:id/publish`
5. Publish classroom task (with optional deadline): `POST /api/classrooms/:classroomId/tasks`
6. Student join: `POST /api/classrooms/join`
7. Student submit:
   - Classroom path: `POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`
8. Trigger one AI pass (debug): `POST /api/learning-tasks/ai-feedback/jobs/process-once`
9. Check outputs:
   - Weekly report: `GET /api/classrooms/:classroomId/weekly-report`
   - Learning trajectory: `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`
   - Review pack: `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`
   - Process assessment JSON: `GET /api/classrooms/:classroomId/process-assessment`
   - Process assessment CSV: `GET /api/classrooms/:classroomId/process-assessment.csv`

---

## 2. Teacher Flow

1. Create course
- Endpoint: `POST /api/courses`

2. Create classroom
- Endpoint: `POST /api/classrooms`

3. Publish classroom task
- Endpoint: `POST /api/classrooms/:classroomId/tasks`
- Deadline fields:
  - `dueAt`: optional
  - `settings.allowLate`: optional, default is `true`
- Deadline rule:
  - `dueAt` empty => no submit gate, no late flag
  - `dueAt` set + `allowLate=false` + now > dueAt => reject with `LATE_SUBMISSION_NOT_ALLOWED`

4. Monitor class execution
- Classroom dashboard: `GET /api/classrooms/:id/dashboard`
- Weekly report: `GET /api/classrooms/:classroomId/weekly-report`
- Review pack: `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`
- Process assessment panel: `GET /api/classrooms/:classroomId/process-assessment`
- Process assessment export: `GET /api/classrooms/:classroomId/process-assessment.csv`

5. Process assessment interpretation
- `score` is process-evaluation reference only, not final grade arbitration.

---

## 3. Student Flow

1. Join classroom
- Endpoint: `POST /api/classrooms/join`

2. View my dashboard
- Endpoint: `GET /api/classrooms/mine/dashboard`

3. View task detail
- Endpoint: `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`

4. Submit
- Endpoint: `POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`
- Late fields in submission response:
  - `submittedAt`
  - `isLate`
  - `lateBySeconds`

5. Manual AI re-request (Z2)
- Endpoint: `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`

6. View feedback / AI status
- Endpoint: `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`
- `aiFeedbackStatus`: `NOT_REQUESTED | PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`

---

## 4. AI Feedback Modes

### 4.1 Mode Definitions
- `stub`:
  - `AI_FEEDBACK_PROVIDER=stub`
  - No external model dependency, best for classroom demo and CI-style stability
- `mock` (deployment pattern, not a separate provider enum):
  - Use `AI_FEEDBACK_PROVIDER=openrouter` + local/mock OpenRouter-compatible endpoint via `OPENROUTER_BASE_URL`
  - Keeps request path realistic while avoiding real upstream cost/risk
- `real`:
  - `AI_FEEDBACK_PROVIDER=openrouter`
  - `AI_FEEDBACK_REAL_ENABLED=true`
  - Valid `OPENROUTER_API_KEY` required

### 4.2 Worker vs Manual Processing
- Worker loop (background):
  - Enable via `AI_FEEDBACK_WORKER_ENABLED=true`
- Manual debug pass:
  - `POST /api/learning-tasks/ai-feedback/jobs/process-once`
  - Requires `AI_FEEDBACK_DEBUG_ENABLED=true`

### 4.3 Job Lifecycle
- `PENDING -> RUNNING -> SUCCEEDED`
- Failure path: `PENDING/FAILED -> RUNNING -> FAILED -> DEAD` (after retries exhausted)

### 4.4 Policy Reminder
- AI is for analysis, hints, and statistics only.
- AI is not a code-writing substitute.

---

## 5. Environment Variables Cheat Sheet

All variables below are current in `backend/src/config/env.validation.ts` unless marked runtime-only.

| Variable | Default | Purpose | Classroom Recommendation |
|---|---:|---|---|
| `AI_FEEDBACK_PROVIDER` | `stub` | Provider selector (`stub`/`openrouter`) | Demo: `stub`; Formal run: `openrouter` |
| `AI_FEEDBACK_REAL_ENABLED` | `false` | Gate real external calls | Demo: `false`; Formal run: `true` |
| `AI_FEEDBACK_DEBUG_ENABLED` | `false` | Enables debug ops endpoints | Pilot ops: `true` |
| `AI_FEEDBACK_MAX_CODE_CHARS` | `12000` | Max code length sent to model | Keep default or lower in early pilot |
| `AI_FEEDBACK_MAX_CONCURRENCY` | `2` | Process-level concurrent analyze calls | Start `1~2`, scale slowly |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30` | Local per-classroomTask soft rate limit | 10~30 depending class size |
| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `true` | Auto enqueue on submission | Keep `true` for first pilot |
| `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | `true` | Auto enqueue first attempt only | Keep `true` to control cost |
| `AI_FEEDBACK_MAX_ITEMS` | `20` | Max saved feedback items per submission | 10~20 for class readability |
| `OPENROUTER_API_KEY` | none | Upstream auth key | Required only in real mode |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL | Mock mode: set local mock URL |
| `OPENROUTER_HTTP_REFERER` | `https://eduforge.local` | Upstream header | Set school/app domain if needed |
| `OPENROUTER_X_TITLE` | `EduForge` | Upstream header title | Keep or rename to deployment title |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Model ID | Start with small/cheap model |
| `OPENROUTER_TIMEOUT_MS` | `15000` | Upstream timeout | 10000~20000 by network quality |
| `OPENROUTER_MAX_RETRIES` | `2` | Provider retry attempts | Keep `1~2` for classroom latency |

Runtime-only (used by worker service, not validated in schema):
- `AI_FEEDBACK_WORKER_ENABLED` (default behavior: disabled unless `true`)
- `AI_FEEDBACK_WORKER_INTERVAL_MS` (default `3000`)
- `AI_FEEDBACK_WORKER_BATCH_SIZE` (optional; falls back to processor default)

---

## 6. Troubleshooting (Symptom -> Possible Cause -> Steps)

### 6.1 Submitted but no feedback
- Possible cause:
  - Job not created or not processed yet
  - Auto enqueue disabled (`AI_FEEDBACK_AUTO_ON_SUBMIT=false`)
- Steps:
  1. Check submission `aiFeedbackStatus` in `my-task-detail`
  2. If debug enabled, inspect jobs: `GET /api/learning-tasks/ai-feedback/jobs`
  3. Trigger one pass: `POST /api/learning-tasks/ai-feedback/jobs/process-once`
  4. Re-check weekly/report-pack if needed for aggregate visibility

### 6.2 Job stays `PENDING`
- Possible cause:
  - Worker disabled
  - Debug/manual process not executed
- Steps:
  1. Verify `AI_FEEDBACK_WORKER_ENABLED`
  2. If disabled, call `process-once`
  3. Check `AI_FEEDBACK_MAX_CONCURRENCY` and batch size settings

### 6.3 `RATE_LIMIT_LOCAL`
- Possible cause:
  - Local per-classroomTask limiter hit
- Steps:
  1. Check `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE`
  2. Spread submissions over time or lower auto-trigger scope
  3. Confirm impact in weekly report AI error distribution

### 6.4 `RATE_LIMIT_UPSTREAM`
- Possible cause:
  - Upstream provider rate limit
- Steps:
  1. Lower concurrency and batch
  2. Increase spacing between process batches
  3. Retry with `process-once` after cooldown

### 6.5 `TIMEOUT`
- Possible cause:
  - Upstream latency/network issues
- Steps:
  1. Increase `OPENROUTER_TIMEOUT_MS` within reason
  2. Reduce request pressure (`MAX_CONCURRENCY`, batch)
  3. Re-run `process-once`

### 6.6 `UNAUTHORIZED`
- Possible cause:
  - Invalid/expired `OPENROUTER_API_KEY`
- Steps:
  1. Verify key configured and non-empty
  2. Ensure `AI_FEEDBACK_REAL_ENABLED=true` only when key is valid
  3. Re-run one job pass

### 6.7 `UPSTREAM_5XX`
- Possible cause:
  - Upstream transient server issue
- Steps:
  1. Retry later via worker/process-once
  2. Keep retries conservative (`OPENROUTER_MAX_RETRIES`)
  3. Use stub/mock mode for class continuity

### 6.8 `LATE_SUBMISSION_NOT_ALLOWED`
- Possible cause:
  - Task overdue with `allowLate=false`
- Steps:
  1. Check classroomTask `dueAt` and `settings.allowLate`
  2. Teacher decides whether to republish/update policy for next run

### 6.9 Enrollment permission `403`
- Possible cause:
  - User is not `Enrollment ACTIVE` in that classroom
- Steps:
  1. Student must join via `POST /api/classrooms/join`
  2. If removed, teacher must re-add via normal flow
  3. Do not treat `classroom.studentIds` as authority

### 6.10 Real mode key valid issue
- Possible cause:
  - `AI_FEEDBACK_PROVIDER` / `AI_FEEDBACK_REAL_ENABLED` / key combination inconsistent
- Steps:
  1. Confirm provider is `openrouter`
  2. Confirm real gate is `true`
  3. Confirm `OPENROUTER_API_KEY` exists and matches environment

### 6.11 Mock mode not taking effect
- Possible cause:
  - Still on `stub`, or `OPENROUTER_BASE_URL` not pointing to mock endpoint
- Steps:
  1. Set `AI_FEEDBACK_PROVIDER=openrouter`
  2. Set `OPENROUTER_BASE_URL` to local mock server
  3. Keep `AI_FEEDBACK_REAL_ENABLED=true` for openrouter path testing

Operational diagnosis endpoints:
- `GET /api/learning-tasks/ai-feedback/jobs`
- `POST /api/learning-tasks/ai-feedback/jobs/process-once`
- `GET /api/classrooms/:classroomId/weekly-report`
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`

---

## 7. Data Isolation Rules

1. `classroomTaskId` is the strict isolation key for task-runtime analytics.
- Submissions/jobs/feedback aggregations are classroomTask-scoped.
- Do not aggregate by shared `taskId` across classes for runtime metrics.

2. Enrollment-only membership authority.
- Membership/authorization/statistics are based on `Enrollment (role=STUDENT, status=ACTIVE)`.
- `classroom.studentIds` is non-authoritative mirror/legacy output compatibility only.

3. Cross-class no-leak principle.
- Same task template reused by multiple classes must never mix stats/samples.
- Teacher dashboards/reports remain classroom/classroomTask isolated.

---

## 8. Security & Cost Control Recommendations

- Keep `AI_FEEDBACK_REAL_ENABLED=false` in classroom demos unless required.
- Start with low concurrency (`AI_FEEDBACK_MAX_CONCURRENCY=1~2`).
- Keep per-classroomTask limiter conservative (`AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE=10~30`).
- Keep item cap controlled (`AI_FEEDBACK_MAX_ITEMS=10~20`).
- Prefer first-attempt auto enqueue (`AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY=true`).
- Never expose API keys in logs/screenshots.
- Avoid returning sensitive fields (`codeText`, prompt, keys) in teaching report exports.

---

## 9. Verification Checklist (Before Class)

- [ ] Enrollment-only membership behavior verified (no legacy authority fallback)
- [ ] Worker policy decided (`AI_FEEDBACK_WORKER_ENABLED`) and communicated
- [ ] Demo class: `AI_FEEDBACK_REAL_ENABLED=false`
- [ ] Rate limit / concurrency tuned to class size
- [ ] Stub or mock path is runnable end-to-end
- [ ] `review-pack` endpoint returns valid payload
- [ ] `process-assessment.csv` exports successfully
- [ ] Core e2e set passes in current environment
