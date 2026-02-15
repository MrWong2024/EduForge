# AI Feedback Jobs

## Design Goals
- Use a Job/Outbox pattern to make AI feedback asynchronous, retryable, and non-blocking for student submissions.
- Keep the worker disabled by default to avoid accidental consumption and keep rollout controllable.
- Provide debug endpoints for operations and troubleshooting without requiring code-level access.

## State Machine
- PENDING: Job is ready to be processed (or scheduled by notBefore).
- RUNNING: Job is claimed by a worker with a lock and is being processed.
- SUCCEEDED: Job finished and feedback has been persisted.
- FAILED: Job failed but can be retried after backoff (notBefore).
- DEAD: Job exceeded maxAttempts and will not be retried.

Typical flow:
PENDING -> RUNNING -> SUCCEEDED

Failure flow:
PENDING/FAILED -> RUNNING -> FAILED -> (retry with backoff) -> DEAD (when attempts >= maxAttempts)

## Worker Behavior
- The worker is disabled by default.
- It starts only when AI_FEEDBACK_WORKER_ENABLED === 'true'.
- It polls using setInterval and calls processOnce(batchSize) per tick.
- Errors are caught and logged; the worker must not crash or exit the process.
- No periodic logs when disabled; only startup info and per-tick debug when enabled.

## Environment Variables
- AI_FEEDBACK_WORKER_ENABLED (default: false)
  - When 'true', the worker starts consuming jobs.
- AI_FEEDBACK_WORKER_INTERVAL_MS (default: 3000)
  - Polling interval in milliseconds.
- AI_FEEDBACK_WORKER_BATCH_SIZE (default: AiFeedbackProcessor.DEFAULT_BATCH_SIZE)
  - Batch size per tick when provided.
- AI_FEEDBACK_DEBUG_ENABLED (default: false)
  - When 'true', debug/ops endpoints are available.
  - When not 'true', debug/ops endpoints return 404 (Not Found).
- AI_FEEDBACK_PROVIDER (default: stub)
  - Current supported values: stub, openrouter
  - Future reserved values (not implemented): openai / deepseek / qwen / local
  - Unsupported values fail fast at startup with a clear error.
- AI_FEEDBACK_REAL_ENABLED (default: false)
  - When 'true', real external AI calls are allowed.
- AI_FEEDBACK_MAX_CODE_CHARS (default: 12000)
  - Max codeText length sent to the model (truncated if longer).
- AI_FEEDBACK_MAX_CONCURRENCY (default: 2)
  - Process-level max concurrent analyzeSubmission calls.
- AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE (default: 30)
  - Soft per-classroomTaskId rate limit per minute.
- AI_FEEDBACK_AUTO_ON_SUBMIT (default: true)
  - When 'false', submission creation never auto-enqueues AI jobs.
- AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY (default: true)
  - When not 'false', only attemptNo===1 auto-enqueues AI jobs.
  - When set to 'false' and AI_FEEDBACK_AUTO_ON_SUBMIT is 'true', every submission auto-enqueues (legacy behavior).
- AI_FEEDBACK_MAX_ITEMS (default: 20)
  - Max feedback items saved per submission (excess items truncated).
- OPENROUTER_API_KEY (required when provider=openrouter and AI_FEEDBACK_REAL_ENABLED === 'true')
- OPENROUTER_BASE_URL (default: https://openrouter.ai/api/v1)
- OPENROUTER_HTTP_REFERER (default: https://eduforge.local)
- OPENROUTER_X_TITLE (default: EduForge)
- OPENROUTER_MODEL (default: openai/gpt-4o-mini)
- OPENROUTER_TIMEOUT_MS (default: 15000)
- OPENROUTER_MAX_RETRIES (default: 2)

## AI Feedback JSON Protocol

Example:
```json
{"items":[{"type":"STYLE","severity":"WARN","message":"Use clearer variable names.","tags":["readability"]}],"meta":{"language":"typescript"}}
```

Notes:
- Root keys: `items` (required) and optional `meta` only.
- `items`: array of feedback objects; `type`/`severity` use enum values from `feedback.schema.ts`.
- `tags`: must come from the list in `feedback-normalizer.ts` (`FEEDBACK_TAGS_LIST`); platform normalizes tags and maps unknown tags to `other`.
- `scoreHint`: optional numeric hint for scoring.

## Testing: Real AI Optional

- Default E2E uses a local mock OpenRouter server (CI friendly).
- To run real integration locally:
  - `REAL_AI_E2E=1`
  - `OPENROUTER_API_KEY_REAL` must be set
- Real mode is for manual verification only; do not enable in CI.

## Debug / Ops Endpoints
- GET /learning-tasks/ai-feedback/jobs
  - Purpose: inspect job queue status and retry state.
  - Typical use: verify a submission has a PENDING/FAILED job.
- POST /learning-tasks/ai-feedback/jobs/process-once
  - Purpose: manually trigger a single processing pass.
  - Typical use: validate pipeline end-to-end during debugging.

Notes:
- These endpoints do not bypass authentication.
- If stricter role checks (teacher/admin) are introduced, this is the control point.

## Manual Request Endpoint
- POST /learning-tasks/submissions/:submissionId/ai-feedback/request
  - Purpose: create or ensure an AI feedback job exists for an existing submission.
  - Access: authenticated teacher/student routes (not controlled by AI_FEEDBACK_DEBUG_ENABLED).
  - Behavior: idempotent by submissionId; existing job is returned, otherwise a new PENDING job is created.

## Teacher Metrics Endpoint
- GET /classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics
  - Purpose: provide teacher-facing AI runtime metrics for a specific classroomTaskId.
  - Query:
    - window: 1h | 24h | 7d (default: 24h)
    - includeTags: boolean (default: true)
  - Access: authenticated teacher/admin and classroom owner only.
  - Time window:
    - Job metrics use updatedAt window filtering when available (fallback to createdAt if schema has no updatedAt).
    - Feedback metrics use createdAt window filtering.
  - Security:
    - This endpoint is not gated by AI_FEEDBACK_DEBUG_ENABLED.
    - Response only includes aggregate counts/rates and error code distribution (no prompt/code/provider raw payloads).
