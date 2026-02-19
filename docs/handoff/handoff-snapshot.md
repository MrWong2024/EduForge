# 全局事实快照（Path Base: `backend/`）

## 0) 事实前提（强制口径）

- 本项目使用 git/GitHub；交接包以当前仓库代码为准（本文不再讨论 git 流程）。
- 版本策略（Node.js/NestJS/MongoDB）以 `docs/backend-architecture.md` 为准，本文不重复。
- 该系统为新系统，无历史数据包袱。
- 因此不需要回填脚本；Enrollment 为权威来源，legacy `studentIds` 不作为任何授权/统计的 fallback。
- 本次扫描基准目录是 `backend/`，即 `backend/src`、`backend/test`、`backend/scripts`。
- `docs/operations/**` 在本次快照中作为运维文档产物被引用（不在 `backend/` 目录树内，但属于工程交付物）。
- `backend/dist/**` 与 `backend/node_modules/**` 不在扫描范围。

## 1) 项目骨架（关键目录树）

```text
backend/
├─ src/
│  ├─ common/{decorators,filters,guards,interfaces,types}
│  ├─ config/{configuration.ts,env.validation.ts}
│  └─ modules/
│     ├─ auth/{controllers,dto,schemas,services}
│     ├─ users/{controllers,dto,schemas,services}
│     ├─ courses/
│     │  ├─ controllers/
│     │  ├─ dto/
│     │  │  └─ query-course-overview.dto.ts
│     │  ├─ schemas/
│     │  └─ services/
│     │     ├─ courses.service.ts
│     │     └─ course-overview.service.ts
│     ├─ classrooms/
│     │  ├─ classroom-tasks/
│     │  │  ├─ controllers/
│     │  │  ├─ dto/
│     │  │  ├─ schemas/
│     │  │  └─ services/
│     │  │     ├─ classroom-tasks.service.ts
│     │  │     ├─ ai-metrics.service.ts
│     │  │     ├─ class-review-pack.service.ts
│     │  │     └─ ai-feedback-metrics-aggregator.service.ts
│     │  ├─ controllers/
│     │  ├─ dto/
│     │  ├─ schemas/
│     │  ├─ services/
│     │  │  ├─ classrooms.service.ts
│     │  │  ├─ teacher-classroom-dashboard.service.ts
│     │  │  ├─ teacher-classroom-weekly-report.service.ts
│     │  │  ├─ student-learning-dashboard.service.ts
│     │  │  ├─ process-assessment.service.ts
│     │  │  └─ classroom-export-snapshot.service.ts
│     │  └─ enrollments/
│     │     ├─ schemas/
│     │     ├─ services/
│     │     └─ README.md
│     ├─ learning-tasks/
│     │  ├─ ai-feedback/
│     │  │  ├─ guards/interfaces/lib/prompts/protocol/providers/real/schemas/services
│     │  ├─ controllers/
│     │  ├─ dto/
│     │  │  └─ request-ai-feedback.dto.ts
│     │  ├─ schemas/
│     │  └─ services/
│     │  (已上线手工触发接口：`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`)
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
│  ├─ learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts
│  ├─ classroom-student-task-detail.e2e-spec.ts
│  ├─ classroom-weekly-report.e2e-spec.ts
│  ├─ course-overview.e2e-spec.ts
│  ├─ enrollments.authority-and-legacy.e2e-spec.ts
│  ├─ enrollment-only.regression.e2e-spec.ts
│  ├─ classroom-learning-trajectory.e2e-spec.ts
│  ├─ classroom-review-pack.e2e-spec.ts
│  ├─ classroom-process-assessment.e2e-spec.ts
│  ├─ classroom-task-deadline.e2e-spec.ts
│  └─ classroom-export-snapshot.e2e-spec.ts
└─ scripts/
   └─ sync-indexes.ts
```

版本策略引用：
- `docs/backend-architecture.md`
- 数据库治理补充：`docs/database-conventions.md`
- E2E 运行基线：`docs/e2e-testing.md`
- 运维 Runbook：`docs/operations/classroom-runbook.md`

## 2) 领域模型摘要卡（按模块）

### Course（`src/modules/courses/schemas/course.schema.ts`）
- 关键字段：`code`、`name`、`term`、`status(ACTIVE|ARCHIVED)`、`createdBy`。
- 索引/唯一性：`unique(createdBy, code)`。

### Classroom（`src/modules/classrooms/schemas/classroom.schema.ts`）
- 关键字段：`courseId`、`name`、`teacherId`、`joinCode`、`studentIds[]`、`status(ACTIVE|ARCHIVED)`。
- 索引/唯一性：`unique(joinCode)`；`(teacherId,courseId,status,createdAt)`。
- `studentIds[]` 口径：仅 legacy 输出/可选镜像；不参与授权、统计、mine 查询，不作为 fallback。

### Enrollment（`src/modules/classrooms/enrollments/schemas/enrollment.schema.ts`）
- 关键字段：`classroomId`、`userId`、`role(STUDENT)`、`status(ACTIVE|REMOVED)`、`joinedAt`、`removedAt?`、`timestamps`。
- 索引/唯一性：
  - `unique(classroomId, userId)`
  - `(classroomId, status)`
  - `(userId, status)`
  - `(classroomId, status, role, userId)`
- 权威性声明：Enrollment 是成员关系唯一权威来源；授权/统计只读 Enrollment。

### ClassroomTask（`src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema.ts`）
- 关键字段：`classroomId`、`taskId`、`publishedAt`、`dueAt?`、`settings.allowLate?`、`settings.maxAttempts?`、`createdBy`。
- 索引/唯一性：`unique(classroomId, taskId)`；`(classroomId, createdAt)`。
- 迟交规则：`settings.allowLate` 默认按实现为 `true`；提交门禁与迟交标记以 `dueAt/allowLate` 为准。

### Task（`src/modules/learning-tasks/schemas/task.schema.ts`）
- 关键字段：`title`、`description`、`knowledgeModule`、`stage(1..4)`、`difficulty?`、`rubric?`、`status(DRAFT|PUBLISHED|ARCHIVED)`、`createdBy`、`publishedAt?`。
- 索引/唯一性：`(createdBy,createdAt)`；`(status,knowledgeModule,stage,createdAt)`。

### Submission（`src/modules/learning-tasks/schemas/submission.schema.ts`）
- 关键字段：`taskId`、`classroomTaskId?`、`studentId`、`attemptNo`、`submittedAt`、`isLate`、`lateBySeconds`、`content.codeText`、`content.language`、`meta.aiUsageDeclaration?`、`status(SUBMITTED|EVALUATED)`。
- 字段语义：
  - `submittedAt`：创建时写入 `now`（与 `createdAt` 语义一致，但用于显式提交时间表达）。
  - `isLate/lateBySeconds`：仅在 `classroomTask.dueAt` 存在时计算；否则 `false/0`。
- 索引/唯一性：
  - `unique(taskId, studentId, attemptNo)`
  - `(taskId, studentId)`、`(taskId, createdAt)`
  - `(classroomTaskId, studentId, createdAt)`
  - `(classroomTaskId, studentId, attemptNo)`
  - `(classroomTaskId, createdAt)`、`(classroomTaskId, _id)`
  - `(classroomTaskId, studentId, submittedAt)`
  - `(classroomTaskId, isLate, submittedAt)`

### AiFeedbackJob（`src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`）
- 关键字段：`submissionId`、`taskId`、`classroomTaskId?`、`studentId`、`status(PENDING|RUNNING|SUCCEEDED|FAILED|DEAD)`、`attempts`、`maxAttempts`、`notBefore?`、`lockedAt?`、`lockOwner?`、`lastError?`。
- 索引/唯一性：`unique(submissionId)`；`(status,notBefore,lockedAt,createdAt)`；`(classroomTaskId,status,notBefore)`；`(classroomTaskId,createdAt)`；`(classroomTaskId,updatedAt)`。
- attempt-based 触发策略：
  - 默认仅 `attemptNo==1` 自动入队；
  - `attemptNo>1` 在 `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY=true` 时不自动创建 job；
  - 手工触发：可通过 `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` 幂等创建 `PENDING` job；
  - “无 job => NOT_REQUESTED” 为正常产品语义。

### Feedback（`src/modules/learning-tasks/schemas/feedback.schema.ts`）
- 关键字段：`submissionId`、`source(AI|TEACHER|SYSTEM)`、`type(...)`、`severity(INFO|WARN|ERROR)`、`message`、`suggestion?`、`tags?`、`scoreHint?`。
- 索引/唯一性：`unique(submissionId,source,type,severity,message)`；`(submissionId,createdAt)`；`(submissionId,source,createdAt)`。
- 隔离字段来源：当前 schema 无 `classroomTaskId` 直连字段；统计隔离通过 `submissionId -> Submission.classroomTaskId` 关联完成。

### User（`src/modules/users/schemas/user.schema.ts`）
- 关键字段：`email`、`passwordHash(select:false)`、`roles[]`、`status(active|suspended)`。
- 索引/唯一性：`unique(email)`。

### Session（`src/modules/auth/schemas/session.schema.ts`）
- 关键字段：`userId`、`token`、`expiresAt`。
- 索引/唯一性：`unique(token)`；TTL(`expiresAt`)；`(userId)`。

## 3) 权威来源提炼（interfaces/protocol/prompts/guards/types）

### 3.1 错误码 / 枚举 / 类型域

AI Provider 错误码（`ai-feedback-provider.error-codes.ts`）：
- `UNAUTHORIZED`
- `RATE_LIMIT_UPSTREAM`
- `RATE_LIMIT_LOCAL`
- `UPSTREAM_4XX`
- `UPSTREAM_5XX`
- `TIMEOUT`
- `BAD_RESPONSE`
- `REAL_DISABLED`
- `MISSING_API_KEY`

业务门禁错误码：
- `LATE_SUBMISSION_NOT_ALLOWED`
  - 出现位置：`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 在 `dueAt` 已到且 `allowLate=false` 时拒绝提交。

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
- `EnrollmentRole`: `STUDENT`
- `EnrollmentStatus`: `ACTIVE|REMOVED`

### 3.2 JSON 协议 / 校验规则（AI）

来源：
- `ai-feedback-json.protocol.ts`
- `openrouter-feedback.prompt.ts`
- `openrouter-feedback.provider.ts`

规则摘要：
- 顶层只允许 `items`（必需）与 `meta`（可选）。
- 每个 item 只允许 `type,severity,message,suggestion,tags,scoreHint`。
- `type/severity` 必须来自枚举值域；`message` 必须非空。
- `tags` 必须来自统一词表；未知值归一化为 `other`。
- 返回必须是单个 JSON 对象（禁止 markdown/code fence/额外字段）。

### 3.3 tags 唯一来源与归一化策略

- 唯一词表来源：`feedback-normalizer.ts` 的 `FEEDBACK_TAGS_LIST`。
- 协议层通过 `getFeedbackTags()` 注入 `AI_FEEDBACK_JSON_PROTOCOL.allowedTags`。
- 归一化：小写、trim、空格/下划线转 `-`、重复连字符折叠、未知值映射 `other`、输出去重。

### 3.4 环境门禁与关键开关

- 认证与授权：
  - `SessionAuthGuard` 全局启用（除 `@Public()`）。
  - `AUTHZ_ENFORCE_ROLES`（默认 `true`）。
- AI 相关：
  - `AI_FEEDBACK_DEBUG_ENABLED`
  - `AI_FEEDBACK_REAL_ENABLED`
  - `AI_FEEDBACK_PROVIDER`
  - `AI_FEEDBACK_WORKER_ENABLED`
  - `AI_FEEDBACK_AUTO_ON_SUBMIT`
  - `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`
  - `AI_FEEDBACK_MAX_CONCURRENCY`
  - `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE`
  - `AI_FEEDBACK_WORKER_INTERVAL_MS`
  - `AI_FEEDBACK_WORKER_BATCH_SIZE`
  - `OPENROUTER_API_KEY`（仅 `openrouter + real enabled` 必填）
- 业务口径补充：Enrollment-only 已收口，legacy `studentIds` 不存在 fallback（该条为业务规则，不是 env 开关）。

### 3.5 providers 子目录提炼

| Provider | 文件 | 说明 |
|---|---|---|
| Stub Provider | `default-stub-ai-feedback.provider.ts` | 本地规则反馈，非外部调用 |
| OpenRouter Provider | `providers/real/openrouter-feedback.provider.ts` | 外部 AI 调用 + 严格 JSON 解析 |
| OpenAI Provider（占位） | `providers/real/openai-feedback.provider.ts` | 预留实现，当前占位 |

## 4) 关键链路概览（隔离口径）

- 主链路：`Course -> Classroom -> Enrollment -> ClassroomTask -> Submission -> AiFeedbackJob -> Feedback -> Dashboard/Report/Export`。
- 成员关系：Enrollment（`ACTIVE/REMOVED`）为唯一权威来源；所有授权/统计只读 Enrollment。
- 关键隔离键：`classroomTaskId`（提交、队列、报表、复盘、导出均按该维度隔离/聚合）。
- `Classroom.studentIds` 仅为 legacy 输出/镜像；系统授权、统计与 mine 查询均不读该字段（Enrollment only）。
- `AiFeedbackStatus=NOT_REQUESTED` 的两类来源（从未创建 job / 策略跳过入队）均为正常产品语义。

新增/变更产品能力（Z3、AA~AI、Z4~Z9 收口口径）：
- AI 指标看板（已存在）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`
- Z3 学生端聚合详情：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`
- AA 班级周报（teacher）：
  - `GET /api/classrooms/:classroomId/weekly-report`
- AB 课程总览（teacher）：
  - `GET /api/courses/:courseId/overview`
- Z4 学习轨迹（teacher）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`
- Z5 课堂复盘包（teacher）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`
- Z6 过程性评价（teacher）：
  - `GET /api/classrooms/:classroomId/process-assessment`
  - `GET /api/classrooms/:classroomId/process-assessment.csv`
- Z7 截止/迟交：
  - 提交门禁：`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 在到期且不允许迟交时返回 `LATE_SUBMISSION_NOT_ALLOWED`
  - 迟交持久字段：`Submission.submittedAt / isLate / lateBySeconds`
  - late 维度已贯穿周报、课程总览、学习轨迹、复盘包、过程性评价、快照导出等聚合接口
- Z9 教学数据快照导出（teacher）：
  - `GET /api/classrooms/:classroomId/export/snapshot`
- 运维收口产物：
  - `docs/operations/classroom-runbook.md`
