# 配置矩阵（Config Matrix）

## 0) 口径说明

- 无 git 场景下，以 `backend/src/config/env.validation.ts` 与 `backend/src/modules/learning-tasks/ai-feedback/README.md` 为准。
- `AI_FEEDBACK_WORKER_*` 变量不在 Joi schema 内，但由 worker 代码与 README 定义默认行为。

## 1) 运行模式矩阵（最小集合）

| 模式 | 目标 | 最小必需 env | 可选 env（默认） | 备注 |
|---|---|---|---|---|
| Stub 模式 | 本地开发/不触网 | `MONGO_URI` | `AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_REAL_ENABLED=false` | 默认模式；不做外部 AI 调用。 |
| Mock OpenRouter 模式（E2E） | CI 友好仿真 real provider | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=test-key`、`OPENROUTER_BASE_URL=http://127.0.0.1:<port>` | `OPENROUTER_MODEL=openai/gpt-4o-mini`、`OPENROUTER_TIMEOUT_MS=15000`、`OPENROUTER_MAX_RETRIES=2` | `learning-tasks.ai-feedback.guards.e2e-spec.ts` 内置本地 mock server。 |
| Real OpenRouter 模式 | 手工真实联调 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=openrouter`、`AI_FEEDBACK_REAL_ENABLED=true`、`OPENROUTER_API_KEY=<real>` | `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`、其余用默认 | 缺 API Key 会在 env 校验阶段 fail-fast。 |

## 2) 核心 env 列表与默认值（来自 `env.validation.ts`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | `development|test|production`。 |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin。 |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Mongo 连接超时。 |
| `AI_FEEDBACK_PROVIDER` | `stub` | `stub|openrouter`。 |
| `AI_FEEDBACK_REAL_ENABLED` | `false` | 是否允许真实外部 AI 调用。 |
| `AI_FEEDBACK_MAX_CODE_CHARS` | `12000` | 发送给模型的代码截断上限。 |
| `AI_FEEDBACK_MAX_CONCURRENCY` | `2` | 进程级并发信号量。 |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30` | 每 `classroomTaskId` 的本地软限流。 |
| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `true` | 是否在提交后自动尝试创建 AI Job。 |
| `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | `true` | 自动入队是否仅限首提（attemptNo=1）。 |
| `AI_FEEDBACK_MAX_ITEMS` | `20` | 每次保存反馈条目上限。 |
| `AI_FEEDBACK_DEBUG_ENABLED` | `false` | debug/ops 路由门禁。 |
| `AUTHZ_ENFORCE_ROLES` | `true` | 是否强制 `RolesGuard` 执行。 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter 基础地址。 |
| `OPENROUTER_HTTP_REFERER` | `https://eduforge.local` | 上游请求头。 |
| `OPENROUTER_X_TITLE` | `EduForge` | 上游请求头。 |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | 模型名。 |
| `OPENROUTER_TIMEOUT_MS` | `15000` | 上游超时（ms）。 |
| `OPENROUTER_MAX_RETRIES` | `2` | provider 重试次数。 |

条件必填：
- 当 `AI_FEEDBACK_PROVIDER=openrouter` 且 `AI_FEEDBACK_REAL_ENABLED=true` 时，`OPENROUTER_API_KEY` 必须存在。

### AI 入队触发策略（attempt-based）组合语义

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

## 3) Worker / Debug 默认关闭与开启方式

默认关闭：
- `AI_FEEDBACK_WORKER_ENABLED=false`（见 `.env.*.example` 与 worker 代码判定）。
- `AI_FEEDBACK_DEBUG_ENABLED=false`（Joi 默认）。

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

debug/ops 门禁口径（与当前实现一致）：
- 全局 `SessionAuthGuard`（`APP_GUARD`）负责非 `@Public()` 路由登录态校验。
- debug/ops 路由显式 `@UseGuards(AiFeedbackDebugEnabledGuard, RolesGuard)`，即先 debug 门禁，再 RBAC。
- 当 `AI_FEEDBACK_DEBUG_ENABLED=false` 时，teacher/admin 访问 debug/ops 仍优先返回 `404`。

## 4) 护栏 env（默认值 + 建议范围）

提示：本节为“执行层护栏”（processor/provider），触发层入队策略见第 2 节“AI 入队触发策略（attempt-based）组合语义”。

| 护栏项 | 变量 | 默认值 | 约束范围（源码） | 建议范围（交付运维） |
|---|---|---|---|---|
| 并发信号量 | `AI_FEEDBACK_MAX_CONCURRENCY` | `2` | `1..20` | `2..6` |
| 软限流（按 classroomTask） | `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30` | `1..600` | `20..120` |
| 单次落库上限 | `AI_FEEDBACK_MAX_ITEMS` | `20` | `1..100` | `10..30` |
| 上游超时 | `OPENROUTER_TIMEOUT_MS` | `15000` | `>=1000` | `10000..30000` |
| provider 重试 | `OPENROUTER_MAX_RETRIES` | `2` | `>=0` | `1..3` |
| 代码截断上限 | `AI_FEEDBACK_MAX_CODE_CHARS` | `12000` | `500..200000` | `8000..30000` |

补充（worker 专属）：
- `AI_FEEDBACK_WORKER_INTERVAL_MS` 默认 `3000`（worker 常量）。
- `AI_FEEDBACK_WORKER_BATCH_SIZE` 未设置时使用 processor 默认批次。
