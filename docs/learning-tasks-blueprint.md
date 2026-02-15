# Learning Tasks 业务模块蓝图

本文档将 `learning-tasks` 模块（含 AI feedback 管线、debug 能力、report 能力、e2e 回归）沉淀为可复制的业务模块蓝图，供后续复用到 `courses` / `classrooms` 等模块。

## 1. 模块职责边界

### 1.1 做什么
- 学习任务（Task）发布与查询。
- 学生提交（Submission）与反馈（Feedback）管理。
- AI 反馈异步管线（Job/Outbox + Worker + Debug 入口）。
- 教学报表（common-issues）聚合统计。

### 1.2 不做什么
- **不处理 Auth 逻辑**：认证与会话由 `auth` 模块统一提供，业务模块仅使用 Guard/Decorator。
- 不在业务模块中改动或替代鉴权机制（详见 `docs/auth-baseline.md`）。

### 1.3 依赖的 common 能力 / 模块
- 鉴权机制：使用项目现有鉴权机制与 Guard/Decorator（以 `docs/auth-baseline.md` 为准）
- 角色体系：如项目已启用角色体系，可使用 `RolesGuard` 与 `@Roles`（如 teacher/admin 等）
- 用户上下文：如项目提供 `@CurrentUser` 等装饰器，按现有约定接入
- 配置：新增 env 必须进入 `src/config/env.validation.ts` 校验，并通过 `ConfigService` 读取；禁止业务代码散落读取 `process.env`
- 用户引用：`users` 模块的 `User` schema 作为 `createdBy` / `studentId` 关联

## 2. 目录结构（tree）

```text
backend/
├─ src/modules/learning-tasks/
│  ├─ learning-tasks.module.ts
│  ├─ controllers/
│  │  └─ learning-tasks.controller.ts
│  ├─ services/
│  │  ├─ learning-tasks.service.ts
│  │  └─ learning-tasks-reports.service.ts
│  ├─ dto/
│  │  ├─ create-task.dto.ts
│  │  ├─ update-task.dto.ts
│  │  ├─ query-task.dto.ts
│  │  ├─ create-submission.dto.ts
│  │  ├─ submission-response.dto.ts
│  │  ├─ create-feedback.dto.ts
│  │  ├─ feedback-response.dto.ts
│  │  ├─ query-ai-feedback-jobs.dto.ts
│  │  └─ process-ai-feedback-jobs.dto.ts
│  ├─ schemas/
│  │  ├─ task.schema.ts
│  │  ├─ submission.schema.ts
│  │  └─ feedback.schema.ts
│  └─ ai-feedback/
│     ├─ README.md
│     ├─ interfaces/
│     │  ├─ ai-feedback-provider.interface.ts
│     │  └─ ai-feedback-status.enum.ts
│     ├─ lib/
│     │  └─ feedback-normalizer.ts
│     ├─ providers/
│     │  └─ real/
│     │     └─ openai-feedback.provider.ts
│     ├─ schemas/
│     │  └─ ai-feedback-job.schema.ts
│     └─ services/
│        ├─ ai-feedback-job.service.ts
│        ├─ ai-feedback-processor.service.ts
│        ├─ ai-feedback-worker.service.ts
│        └─ default-stub-ai-feedback.provider.ts
└─ test/
   ├─ learning-tasks.e2e-spec.ts
   └─ learning-tasks.ai-feedback.e2e-spec.ts
```

## 3. 领域模型与关键字段

### 3.1 Task
- 状态：`DRAFT | PUBLISHED | ARCHIVED`
- 关键字段：
  - `title`, `description`, `knowledgeModule`, `stage`, `difficulty?`
  - `rubric?: Record<string, unknown>`
  - `status`, `createdBy(User)`, `publishedAt?`
- 时间：`createdAt`, `updatedAt`

### 3.2 Submission
- 状态：`SUBMITTED | EVALUATED`
- 关键字段：
  - `taskId(Task)`, `studentId(User)`, `attemptNo`
  - `content: { codeText, language }`
  - `meta?: { aiUsageDeclaration? }`
- 索引：
  - `unique(taskId, studentId, attemptNo)`
  - `index(taskId, studentId)`
- 主要服务于接口/查询：`GET /learning-tasks/tasks/:id/submissions`、`GET /learning-tasks/tasks/:id/submissions/mine`

### 3.3 Feedback
- 维度：
  - `source: AI | TEACHER | SYSTEM`
  - `type: SYNTAX | STYLE | DESIGN | BUG | PERFORMANCE | SECURITY | OTHER`
  - `severity: INFO | WARN | ERROR`
- 关键字段：`message`, `suggestion?`, `tags?: string[]`, `scoreHint?`
- 索引：`unique(submissionId, source, type, severity, message)`
- 主要服务于接口/查询：`GET /learning-tasks/submissions/:id/feedback`、`GET /learning-tasks/tasks/:id/reports/common-issues`

### 3.4 Job（AiFeedbackJob）
- 状态机：`PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`
- 关键字段：
  - `submissionId`, `taskId`, `studentId`
  - `attempts`, `maxAttempts`
  - `notBefore?`, `lockedAt?`, `lockOwner?`, `lastError?`
- 索引：`unique(submissionId)`
- 主要服务于接口/查询：`GET /learning-tasks/ai-feedback/jobs`、`POST /learning-tasks/ai-feedback/jobs/process-once`

## 4. 异步管线约定（AI Feedback Jobs）

### 4.1 状态机与重试
- 正常流：`PENDING -> RUNNING -> SUCCEEDED`
- 失败流：`PENDING/FAILED -> RUNNING -> FAILED -> (backoff) -> DEAD`
- `attempts` 自增，`maxAttempts` 默认值以 `AiFeedbackJobService.DEFAULT_MAX_ATTEMPTS` 与 schema 默认值为准（见 `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts` 与 `backend/src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`）。
- 退避：指数回退，默认基准与上限以 `AiFeedbackProcessor.BASE_BACKOFF_MS` / `AiFeedbackProcessor.MAX_BACKOFF_MS` 为准（见 `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`）；`notBefore` 控制下一次可处理时间。

### 4.2 锁与并发
- 通过 `lockedAt` + `lockOwner` 抢占处理权，锁过期默认值以 `AiFeedbackProcessor.LOCK_TTL_MS` 为准（见 `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`）。
- 仅处理 `PENDING/FAILED` 且满足 `notBefore` 条件、锁过期条件的任务。

### 4.3 Worker 开关
- 默认 **关闭**，仅当 `AI_FEEDBACK_WORKER_ENABLED === 'true'` 启动。
- 轮询间隔：`AI_FEEDBACK_WORKER_INTERVAL_MS` 默认值以 `AiFeedbackWorker.DEFAULT_INTERVAL_MS` 为准（见 `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`）。
- 批大小：`AI_FEEDBACK_WORKER_BATCH_SIZE` 默认值以 `AiFeedbackProcessor.DEFAULT_BATCH_SIZE` 为准（见 `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`）。

### 4.4 Provider 选择
- 依赖 `AI_FEEDBACK_PROVIDER` 环境变量选择实现：`stub`（默认）/ `openai`。
- 非法值 **fail fast**，启动即报错。
- 注入 token：`AI_FEEDBACK_PROVIDER_TOKEN`。

### 4.5 Debug / Ops 接口
- `GET /learning-tasks/ai-feedback/jobs`
  - 查询任务列表（支持 status + limit）。
- `POST /learning-tasks/ai-feedback/jobs/process-once`
  - 手动触发一次处理（可指定 batchSize）。
- 说明：接口鉴权使用项目现有机制与 Guard/Decorator（以 `docs/auth-baseline.md` 为准）；如项目已启用角色体系，可限定 teacher/admin 等角色。

## 5. 教学报表约定（common-issues）

### 5.1 入口
- `GET /learning-tasks/tasks/:id/reports/common-issues?limit=1..10`
- Teacher 权限，校验任务创建者。

### 5.2 口径与数据源
- 仅统计 `Feedback.source in ['AI', 'TEACHER']`。
- `topTags` 由 `feedback.tags` 聚合。
- `topTypes` 由 `feedback.type` 聚合。
- `examples` 基于标签分组，按创建时间倒序取样（每 tag 最多 3 条）。

### 5.3 输出结构
- `summary.submissionsCount`
- `summary.distinctStudentsCount`
- `topTags[]: { tag, count, severityBreakdown: { INFO, WARN, ERROR } }`
- `topTypes[]: { type, count }`
- `examples[]: { tag, count, samples: [{ submissionId, message, suggestion?, severity }] }`

## 6. e2e 回归策略

### 6.1 必须覆盖的用例
- 任务闭环：创建任务 -> 发布 -> 学生提交 -> 教师反馈 -> 统计接口。
- AI feedback 管线：提交后生成 job -> debug list 查询 -> process-once 处理 -> 反馈落库 -> 状态回写。
- 教学报表：`common-issues` 能返回 tags/examples 且与反馈一致。

### 6.2 当前回归入口（参考）
- `backend/test/learning-tasks.e2e-spec.ts`
- `backend/test/learning-tasks.ai-feedback.e2e-spec.ts`

### 6.3 不该强绑定的内容
- 不绑定具体 AI 模型输出或文案（只校验结构与状态流转）。
- 不强依赖 stub provider 的具体 message 文本。
- 不将 e2e 写成“精确数量/排序”的硬断言（除非业务明确要求）。

### 6.4 环境与数据治理
- 必须遵循 `docs/e2e-testing.md`：`NODE_ENV=test`、`MONGO_URI`、隔离数据库、`KEEP_E2E_DB` 仅限本地调试。

### 6.x Debug 接口相关 e2e 说明

AI Feedback Debug / Ops 接口默认受 `AI_FEEDBACK_DEBUG_ENABLED=false` 保护，
在执行 `learning-tasks.ai-feedback.e2e-spec.ts` 前，
需在当前 shell 中显式开启：

```powershell
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
npm run test:e2e -- learning-tasks.ai-feedback.e2e-spec.ts
```

测试完成后应立即恢复默认状态：
```powershell
Remove-Item Env:AI_FEEDBACK_DEBUG_ENABLED -ErrorAction SilentlyContinue
```

## 7. 下一模块复制 Checklist（10 项）

1. 明确业务边界：不处理 Auth，仅接入 Guard/Decorator。
2. 按模块标准结构创建目录骨架（controller/service/dto/schema）。
3. 定义领域模型与状态枚举（含索引与唯一性约束）。
4. 明确异步管线是否需要 Job/Outbox（如有，定义状态机与 retry）。
5. 设计 debug/ops 接口（只做可观测与手动触发，不绕过权限）。
6. 规划 provider 选择与注入 token（含默认实现与非法值 fail fast）。
7. 报表口径先定规则再实现（tag/type/示例选择标准）。
8. 补齐 DTO 与 response shape，避免 controller 直接返回实体。
9. 添加 e2e 回归：核心闭环 + 管线/报表 + 权限校验。
10. 更新相关文档（架构/模块蓝图/测试规范引用）。
