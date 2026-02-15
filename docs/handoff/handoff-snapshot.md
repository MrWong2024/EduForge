# 全局事实快照（Path Base: `backend/`）

## 0) 事实前提（强制口径）

- 本项目当前不使用 git。
- 版本策略（Node.js/NestJS/MongoDB）以 `docs/backend-architecture.md` 为准，本文不重复。
- 该系统为新系统，无 legacy 数据；不引入 legacy 处理策略或迁移假设。
- 本次扫描基准目录是 `backend/`，即 `backend/src`、`backend/test`、`backend/scripts`。
- `backend/dist/**` 与 `backend/node_modules/**` 不在扫描范围。

## 1) 项目骨架（关键目录树）

```text
backend/
├─ src/
│  ├─ common/
│  │  ├─ decorators/
│  │  ├─ filters/
│  │  ├─ guards/
│  │  ├─ interfaces/
│  │  └─ types/
│  ├─ config/
│  │  ├─ configuration.ts
│  │  └─ env.validation.ts
│  └─ modules/
│     ├─ auth/{controllers,dto,schemas,services}
│     ├─ users/{controllers,dto,schemas,services}
│     ├─ courses/{controllers,dto,schemas,services}
│     ├─ classrooms/
│     │  ├─ classroom-tasks/{controllers,dto,schemas,services}
│     │  ├─ controllers/
│     │  ├─ dto/
│     │  ├─ schemas/
│     │  └─ services/
│     ├─ learning-tasks/
│     │  ├─ ai-feedback/
│     │  │  ├─ guards/interfaces/lib/prompts/protocol/providers/real/schemas/services
│     │  ├─ controllers/
│     │  ├─ dto/
│     │  ├─ schemas/
│     │  └─ services/
│     └─ database/
├─ test/
│  ├─ app.e2e-spec.ts
│  ├─ classroom-dashboard.e2e-spec.ts
│  ├─ classroom-dashboard-isolation.e2e-spec.ts
│  ├─ classrooms.ai-metrics.e2e-spec.ts
│  ├─ classroom-learning-loop.e2e-spec.ts
│  ├─ learning-tasks.e2e-spec.ts
│  ├─ learning-tasks.ai-feedback.guards.e2e-spec.ts
│  ├─ learning-tasks.ai-feedback.ops.e2e-spec.ts
│  ├─ learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts
│  └─ learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts
└─ scripts/
   └─ sync-indexes.ts
```

版本策略引用：
- `docs/backend-architecture.md`
- 数据库治理补充：`docs/database-conventions.md`
- E2E 运行基线：`docs/e2e-testing.md`

## 2) 领域模型摘要卡（按模块）

### Course（`src/modules/courses/schemas/course.schema.ts`）
- 关键字段：`code`、`name`、`term`、`status(ACTIVE|ARCHIVED)`、`createdBy`。
- 索引/唯一性：`unique(createdBy, code)`。
- 与 `classroomTaskId` 关系：无直接字段；通过 `Classroom.courseId` 间接关联。

### Classroom（`src/modules/classrooms/schemas/classroom.schema.ts`）
- 关键字段：`courseId`、`name`、`teacherId`、`joinCode`、`studentIds[]`、`status(ACTIVE|ARCHIVED)`。
- 索引/唯一性：`unique(joinCode)`；`(teacherId,courseId,status,createdAt)` 查询索引。
- 与 `classroomTaskId` 关系：`ClassroomTask.classroomId` 的上游实体。

### ClassroomTask（`src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema.ts`）
- 关键字段：`classroomId`、`taskId`、`publishedAt`、`dueAt?`、`settings.allowLate?`、`settings.maxAttempts?`、`createdBy`。
- 索引/唯一性：`unique(classroomId, taskId)`；`(classroomId,createdAt)`。
- 与 `classroomTaskId` 关系：该实体 `_id` 即隔离主键，后续 Submission/Job/Dashboard 全按它聚合。

### Task（`src/modules/learning-tasks/schemas/task.schema.ts`）
- 关键字段：`title`、`description`、`knowledgeModule`、`stage(1..4)`、`difficulty?`、`rubric?`、`status(DRAFT|PUBLISHED|ARCHIVED)`、`createdBy`、`publishedAt?`。
- 索引/唯一性：`(createdBy,createdAt)`；`(status,knowledgeModule,stage,createdAt)`。
- 与 `classroomTaskId` 关系：通过 `ClassroomTask.taskId` 被课堂发布实例化。

### Submission（`src/modules/learning-tasks/schemas/submission.schema.ts`）
- 关键字段：`taskId`、`classroomTaskId?`、`studentId`、`attemptNo`、`content.codeText`、`content.language`、`meta.aiUsageDeclaration?`、`status(SUBMITTED|EVALUATED)`。
- 索引/唯一性：`unique(taskId,studentId,attemptNo)`；`(taskId,studentId)`；`(taskId,createdAt)`；`(classroomTaskId,studentId,createdAt)`；`(classroomTaskId,createdAt)`。
- 与 `classroomTaskId` 关系：隔离关键字段；课堂报表与学习看板都依赖它隔离统计。

### AiFeedbackJob（`src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`）
- 关键字段：`submissionId`、`taskId`、`classroomTaskId?`、`studentId`、`status(PENDING|RUNNING|SUCCEEDED|FAILED|DEAD)`、`attempts`、`maxAttempts`、`notBefore?`、`lockedAt?`、`lockOwner?`、`lastError?`。
- 索引/唯一性：`unique(submissionId)`；`(status,notBefore,lockedAt,createdAt)`；`(classroomTaskId,status,notBefore)`；`(classroomTaskId,createdAt)`。
- 与 `classroomTaskId` 关系：Job 维度隔离与限流桶键来源，Dashboard 按该字段聚合成功/失败/未请求。
- attempt-based 触发策略说明：
  - 默认仅 `attemptNo==1` 自动入队；
  - `attemptNo>1` 在 `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY=true` 时不会自动创建 job；
  - “无 job”是合法策略结果，不视为异常；
  - 手工 request 接口可幂等创建 `PENDING` job。
  - 该策略仅影响“是否创建 job（触发层）”，不影响“job 的消费与执行（worker/processor/provider 执行层）”。

### Feedback（`src/modules/learning-tasks/schemas/feedback.schema.ts`）
- 关键字段：`submissionId`、`source(AI|TEACHER|SYSTEM)`、`type(...)`、`severity(INFO|WARN|ERROR)`、`message`、`suggestion?`、`tags?`、`scoreHint?`。
- 索引/唯一性：`unique(submissionId,source,type,severity,message)`；`(submissionId,createdAt)`。
- 与 `classroomTaskId` 关系：无直接字段；经 `submissionId -> Submission.classroomTaskId` 进行隔离汇总。

### User（`src/modules/users/schemas/user.schema.ts`）
- 关键字段：`email`、`passwordHash(select:false)`、`roles[]`、`status(active|suspended)`。
- 索引/唯一性：`unique(email)`。
- 与 `classroomTaskId` 关系：`teacherId/studentId` 参与权限判定与分组，不作为隔离键。

### Session（`src/modules/auth/schemas/session.schema.ts`）
- 关键字段：`userId`、`token`、`expiresAt`。
- 索引/唯一性：`unique(token)`；TTL(`expiresAt`)；`(userId)`。
- 与 `classroomTaskId` 关系：无；提供登录态。

## 3) 权威来源提炼（interfaces/protocol/prompts/guards/types）

### 3.1 错误码 / 枚举 / 类型域

错误码（`ai-feedback-provider.error-codes.ts`）：
- `UNAUTHORIZED`
- `RATE_LIMIT_UPSTREAM`
- `RATE_LIMIT_LOCAL`
- `UPSTREAM_4XX`
- `UPSTREAM_5XX`
- `TIMEOUT`
- `BAD_RESPONSE`
- `REAL_DISABLED`
- `MISSING_API_KEY`

关键枚举：
- `AiFeedbackStatus`: `NOT_REQUESTED|PENDING|RUNNING|SUCCEEDED|FAILED|DEAD`
- `AiFeedbackJobStatus`: `PENDING|RUNNING|SUCCEEDED|FAILED|DEAD`
- `TaskStatus`: `DRAFT|PUBLISHED|ARCHIVED`
- `SubmissionStatus`: `SUBMITTED|EVALUATED`
- `FeedbackSource`: `AI|TEACHER|SYSTEM`
- `FeedbackType`: `SYNTAX|STYLE|DESIGN|BUG|PERFORMANCE|SECURITY|OTHER`
- `FeedbackSeverity`: `INFO|WARN|ERROR`
- `CourseStatus`: `ACTIVE|ARCHIVED`
- `ClassroomStatus`: `ACTIVE|ARCHIVED`

类型约束：
- `AiFeedbackProviderErrorCode` 是 `AI_FEEDBACK_ERROR_CODES` 值域联合类型。
- `AiFeedbackItem` 强约束 `type/severity/message`，可选 `suggestion/tags/scoreHint`。

### 3.2 JSON 协议 / 校验规则（AI）

来源：
- `ai-feedback-json.protocol.ts`
- `openrouter-feedback.prompt.ts`
- `openrouter-feedback.provider.ts`

规则摘要：
- 顶层只允许 `items`（必需）与 `meta`（可选）。
- 每个 item 只允许 `type,severity,message,suggestion,tags,scoreHint`。
- `type/severity` 必须来自枚举值域。
- `message` 必须非空字符串。
- `tags` 必须来自统一词表；未知值会归一化为 `other`。
- 返回必须是单个 JSON 对象（禁止 markdown/code fence/额外字段）。

### 3.3 tags 唯一来源与归一化策略

唯一来源：
- 词表来源 `feedback-normalizer.ts` 的 `FEEDBACK_TAGS_LIST`。
- 协议层通过 `getFeedbackTags()` 注入 `AI_FEEDBACK_JSON_PROTOCOL.allowedTags`。

归一化策略：
- 小写、trim、空格/下划线转 `-`、重复连字符折叠。
- 不在词表内的 tag 映射为 `other`。
- 输出去重（Set）。
- 明确禁止第二词表（协议与 normalizer 共享同一来源）。

### 3.4 环境门禁与关键开关

- `SessionAuthGuard`：已通过 `APP_GUARD` 全局启用；除 `@Public()` 外默认要求登录。
- `validateSession`：认证成功后注入 `req.user = { id, roles }`，供后续授权与资源校验复用。
- `AUTHZ_ENFORCE_ROLES`：角色强制开关（默认 `true`）；设为 `false` 可临时关闭 `RolesGuard` enforce（兼容期）。
- `AI_FEEDBACK_DEBUG_ENABLED`：debug/ops 接口门禁（默认 `false`），false 时返回 404（`AiFeedbackDebugEnabledGuard`）。
- `AI_FEEDBACK_REAL_ENABLED`：控制是否允许真实外部 AI 调用（默认 `false`）。
- `AI_FEEDBACK_PROVIDER`：`stub|openrouter`（默认 `stub`），非法值启动即 fail-fast。
- `AI_FEEDBACK_WORKER_ENABLED`：worker 启动开关（默认 `false`），仅显式 true 启动。
- `AI_FEEDBACK_AUTO_ON_SUBMIT`：提交后是否自动尝试入队（默认 `true`）。
- `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`：自动入队是否仅限首提（默认 `true`）。
- `AI_FEEDBACK_MAX_CONCURRENCY`：processor 并发护栏（默认 `2`，进程内信号量上限）。
- `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE`：按 `classroomTaskId` 的本地软限流阈值（默认 `30`）。
- `AI_FEEDBACK_WORKER_INTERVAL_MS`：worker 轮询间隔（默认 `3000`，仅影响消费调度频率）。
- `AI_FEEDBACK_WORKER_BATCH_SIZE`：worker 每轮处理批次大小（默认由 `AiFeedbackProcessor.DEFAULT_BATCH_SIZE` 决定（以代码为准；如常量调整，文档无需同步数值））。
- `OPENROUTER_API_KEY`：仅在 `AI_FEEDBACK_PROVIDER=openrouter && AI_FEEDBACK_REAL_ENABLED=true` 时必填（`env.validation.ts`）。

### 3.5 providers 子目录提炼

| Provider | 文件 | 职责 | 关键 Env | Fail-fast/Fallback | 错误映射 | 外部调用 |
|---|---|---|---|---|---|---|
| Stub Provider | `default-stub-ai-feedback.provider.ts` | 本地规则生成反馈（空代码/短代码/TODO） | 无硬依赖 | 无外部调用；总能返回归一化结果 | 不走 provider error code | 否 |
| OpenRouter Provider | `providers/real/openrouter-feedback.provider.ts` | 调 OpenRouter chat/completions 并严格 JSON 解析 | `AI_FEEDBACK_REAL_ENABLED`、`OPENROUTER_*`、`AI_FEEDBACK_MAX_*` | 当 OpenRouter Provider 被选中时：若 `AI_FEEDBACK_REAL_ENABLED=false` -> `REAL_DISABLED`；若 `AI_FEEDBACK_REAL_ENABLED=true` 且缺 `OPENROUTER_API_KEY` -> `MISSING_API_KEY`；解析失败 -> `BAD_RESPONSE`；重试仅对 retryable 错误 | HTTP 401/403→`UNAUTHORIZED`，429→`RATE_LIMIT_UPSTREAM`，5xx→`UPSTREAM_5XX`，超时→`TIMEOUT` | 是 |
| OpenAI Provider（占位） | `providers/real/openai-feedback.provider.ts` | 预留 provider，当前未实现 | 预期 `OPENAI_API_KEY`（提示文案） | 调用即抛错，提示人工决定依赖安装 | 无细分映射 | 否（当前实现） |

## 4) 关键链路概览（隔离口径）

- 主链路：`Course -> Classroom -> ClassroomTask -> Submission -> AiFeedbackJob -> Feedback -> Dashboard/Report`。
- 关键隔离键：`classroomTaskId`（提交、任务队列、教师看板、学生看板均按该维度隔离/聚合）。
- 跨班复用同一 `taskId`：通过不同 `classroomTaskId` 实例化，统计不串班。
- dashboard `notRequested` 口径：`submissionsCount - (pending+running+succeeded+failed+dead)`，下限裁剪为 0。
- 新增产品能力：
  - 教师可通过 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` 获取 AI 执行统计（jobs 状态、成功率、错误码分布、feedback 统计、可选 tags 聚合）。
  - 所有统计严格按 `classroomTaskId` 隔离。
  - 不返回敏感字段（`codeText` / `prompt` / `provider raw response` / `API key`）。
- `AiFeedbackStatus=NOT_REQUESTED` 有两种来源：
  1) 从未创建 job；
  2) attempt-based 策略跳过入队；
  均属于正常产品语义，不代表错误。
