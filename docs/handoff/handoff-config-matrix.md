# 配置矩阵（Config Matrix）

## 0) 口径说明

- 本系统为新系统，无历史数据包袱。
- Enrollment-only 已收口：成员权威来源仅为 `Enrollment(role=STUDENT,status=ACTIVE)`；`classroom.studentIds` 仅为 legacy 输出/镜像，不参与任何授权/统计（这是业务口径，不是 env 开关）。
- env 默认值以 `backend/src/config/env.validation.ts` 为准。
- `AI_FEEDBACK_WORKER_*` 不在 Joi schema 内；其默认行为来自 worker/processor 源码常量与 `backend/src/modules/learning-tasks/ai-feedback/README.md`。

## 1) 运行模式矩阵（最小可运维闭环）

| 模式 | 执行方式 | 目标 | 必要 env | 可选 env（默认） | 备注 |
|---|---|---|---|---|---|
| Stub | `worker` | 本地开发/不触网，后台持续消费 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_REAL_ENABLED=false`、`AI_FEEDBACK_WORKER_ENABLED=true` | `AI_FEEDBACK_WORKER_INTERVAL_MS=3000`、`AI_FEEDBACK_WORKER_BATCH_SIZE=5`（未设时走 processor 默认） | 默认不触发外部 AI。 |
| Stub | `process-once` | 本地排障，一次性处理一批 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_REAL_ENABLED=false`、`AI_FEEDBACK_DEBUG_ENABLED=true` | `AI_FEEDBACK_WORKER_ENABLED=false` | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`（不是 `403`）。 |
| Mock OpenRouter（E2E） | `worker` | CI/联调仿真 real provider | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=test-key`、`OPENROUTER_BASE_URL=http://127.0.0.1:<port>`、`AI_FEEDBACK_WORKER_ENABLED=true` | `OPENROUTER_MODEL=openai/gpt-4o-mini`、`OPENROUTER_TIMEOUT_MS=15000`、`OPENROUTER_MAX_RETRIES=2`、worker 两项同上 | 可配本地 mock server。 |
| Mock OpenRouter（E2E） | `process-once` | CI/联调排障，一次性处理 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=test-key`、`OPENROUTER_BASE_URL=http://127.0.0.1:<port>`、`AI_FEEDBACK_DEBUG_ENABLED=true` | 同 mock openrouter 默认项 | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`。 |
| Real OpenRouter | `worker` | 真实上游持续消费 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=<real>`、`AI_FEEDBACK_WORKER_ENABLED=true` | `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`、worker 两项同上 | 缺 key 会在 env 校验阶段 fail-fast。 |
| Real OpenRouter | `process-once` | 真实上游手工批处理排障 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=<real>`、`AI_FEEDBACK_DEBUG_ENABLED=true` | `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`。 |

补充门禁说明：
- `process-once` 属于 debug/ops 门禁路由：需登录 + RBAC（teacher）+ `AI_FEEDBACK_DEBUG_ENABLED=true`；否则按现实现返回 `404`。
- `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` 是产品能力，不依赖 debug 门禁；但依赖登录 + RBAC + 资源归属校验。

## 2) 核心 env 列表与默认值

| 变量 | 默认值 | 来源 | 说明 |
|---|---|---|---|
| `NODE_ENV` | `development` | Joi | `development|test|production`。 |
| `FRONTEND_URL` | `http://localhost:3000` | Joi | CORS origin。 |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Joi | Mongo 连接超时。 |
| `AI_FEEDBACK_PROVIDER` | `stub` | Joi | `stub|openrouter`。 |
| `AI_FEEDBACK_REAL_ENABLED` | `false` | Joi | 是否允许真实外部 AI 调用。 |
| `AI_FEEDBACK_MAX_CODE_CHARS` | `12000` | Joi | 发送给模型的代码截断上限。 |
| `AI_FEEDBACK_MAX_CONCURRENCY` | `2` | Joi | 进程级并发信号量。 |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30` | Joi | 每 `classroomTaskId` 的本地软限流。 |
| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `true` | Joi | 提交后是否自动尝试创建 AI Job。 |
| `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | `true` | Joi | 自动入队是否仅限首提（attemptNo=1）。 |
| `AI_FEEDBACK_MAX_ITEMS` | `20` | Joi | 每次保存反馈条目上限。 |
| `AI_FEEDBACK_DEBUG_ENABLED` | `false` | Joi | debug/ops 路由门禁。 |
| `AUTHZ_ENFORCE_ROLES` | `true` | Joi | 是否强制 `RolesGuard` 执行。 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Joi | OpenRouter 基础地址。 |
| `OPENROUTER_HTTP_REFERER` | `https://eduforge.local` | Joi | 上游请求头。 |
| `OPENROUTER_X_TITLE` | `EduForge` | Joi | 上游请求头。 |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Joi | 模型名。 |
| `OPENROUTER_TIMEOUT_MS` | `15000` | Joi | 上游超时（ms）。 |
| `OPENROUTER_MAX_RETRIES` | `2` | Joi | provider 重试次数。 |
| `AI_FEEDBACK_WORKER_ENABLED` | `false` | Worker 源码/README | `true` 才启动常驻轮询；默认关闭。 |
| `AI_FEEDBACK_WORKER_INTERVAL_MS` | `3000` | Worker 源码/README | 轮询间隔（ms）；非法值回退默认。 |
| `AI_FEEDBACK_WORKER_BATCH_SIZE` | `5` | Processor 常量/README | 每 tick 批次；未设置或非法值时走 `processOnce()` 默认批次 `5`。 |

条件必填：
- 当 `AI_FEEDBACK_PROVIDER=openrouter` 且 `AI_FEEDBACK_REAL_ENABLED=true` 时，`OPENROUTER_API_KEY` 必须存在。
- 该组合缺失 key 通常会在 env 校验阶段 fail-fast（当前实现）。

### 2.1 AI 入队触发策略（attempt-based）组合语义

说明：
- 仅影响“Submission 创建后是否自动创建 AI Job（enqueue）”的触发层行为。
- 不影响执行层（worker/processor/provider）对“已存在 Job”的消费与处理。

| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | 行为 |
|---|---|---|
| `true` | `true` | 仅首提（attemptNo=1）自动入队；后续提交默认不入队（`NOT_REQUESTED`）。 |
| `true` | `false` | 每次提交都自动入队（保持旧行为）。 |
| `false` | 任意 | 不自动入队；只能通过产品级手工 request 创建 Job。 |

补充：
- 当后续提交未自动入队时，“无 Job”是策略结果，应体现为 `NOT_REQUESTED`，不代表系统异常。
- “无 job => NOT_REQUESTED” 是正常产品语义，适用于 dashboards / `my-task-detail` / `learning-trajectory` 等聚合视图。

### 2.2 关键业务门禁错误码与排障指引

- `LATE_SUBMISSION_NOT_ALLOWED`
  - 触发条件：`classroomTask.dueAt` 存在，且 `settings.allowLate=false`，且 `now > dueAt`。
  - HTTP：`403`（当前实现）。
  - 排障要点：若 `dueAt` 为空，则不限制提交，且 `isLate=false`。

## 3) Worker / Debug 默认关闭与开启方式

默认关闭：
- `AI_FEEDBACK_WORKER_ENABLED=false`。
- `AI_FEEDBACK_DEBUG_ENABLED=false`。

开启方式（PowerShell）：
```powershell
cd backend
$env:AI_FEEDBACK_WORKER_ENABLED="true"
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
npm run start:dev
```

关闭恢复：
```powershell
Remove-Item Env:AI_FEEDBACK_WORKER_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:AI_FEEDBACK_DEBUG_ENABLED -ErrorAction SilentlyContinue
```

最小排障路径：
- 不开 worker 时，可用 `POST /api/learning-tasks/ai-feedback/jobs/process-once` 手动处理一批（受 debug 门禁）。
- 不开 debug 时，`process-once` 路由返回 `404` 属正常；此时只能开 worker，或走产品手工 request（`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`）后等待 worker 消费。

debug/ops 门禁口径（与当前实现一致）：
- 全局 `SessionAuthGuard`（`APP_GUARD`）负责非 `@Public()` 路由登录态校验。
- debug/ops 路由显式 `@UseGuards(AiFeedbackDebugEnabledGuard, RolesGuard)`，即先 debug 门禁，再 RBAC。
- 当 `AI_FEEDBACK_DEBUG_ENABLED=false` 时，teacher/admin 访问 debug/ops 优先返回 `404`。

## 4) 护栏 env（默认值 + 建议范围）

提示：本节为“执行层护栏”（processor/provider）；触发层入队策略见第 2.1 节。

| 护栏项 | 变量 | 默认值 | 约束范围（源码） | 建议范围（交付运维） |
|---|---|---|---|---|
| 并发信号量 | `AI_FEEDBACK_MAX_CONCURRENCY` | `2` | `1..20` | `2..6` |
| 软限流（按 classroomTask） | `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30` | `1..600` | `20..120` |
| 单次落库上限 | `AI_FEEDBACK_MAX_ITEMS` | `20` | `1..100` | `10..30` |
| 上游超时 | `OPENROUTER_TIMEOUT_MS` | `15000` | `>=1000` | `10000..30000` |
| provider 重试 | `OPENROUTER_MAX_RETRIES` | `2` | `>=0` | `1..3` |
| 代码截断上限 | `AI_FEEDBACK_MAX_CODE_CHARS` | `12000` | `500..200000` | `8000..30000` |

补充（worker 专属）：
- `AI_FEEDBACK_WORKER_ENABLED`：默认 `false`，控制是否启动常驻轮询。
- `AI_FEEDBACK_WORKER_INTERVAL_MS`：默认 `3000`，控制每次轮询间隔。
- `AI_FEEDBACK_WORKER_BATCH_SIZE`：默认跟随 processor 批次 `5`，控制每次 tick 处理数量。

成本提醒：
- 打开 `AI_FEEDBACK_REAL_ENABLED` 后，并发/限流/maxItems 会直接影响调用成本与上游压力。
