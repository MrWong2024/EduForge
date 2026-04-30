# 全局事实快照（Path Base: `backend/`）

## 0) 事实前提（强制口径）

- 本项目使用 git/GitHub 进行版本管理。
- 但在 AI 协作开发中，唯一权威来源是当前工作区目录中的本地代码状态（working tree）。
- 任何 handoff 文档、分析结论或续接开发，均必须以当前工作区代码为准，而不是 GitHub 仓库状态、commit 历史、分支信息或 PR 记录。
- 本交接包不依赖 git 工作流。
- 当文档与代码发生冲突时，以代码为准。
- 版本策略（Node.js/NestJS/MongoDB）以 `docs/backend-architecture.md` 为准，本文不重复。
- 该系统为新系统，无历史数据包袱。
- 因此不需要回填脚本；Enrollment 为权威来源，legacy `studentIds` 不作为任何授权/统计的 fallback。
- 本次扫描基准目录是 `backend/`，即 `backend/src`、`backend/test`、`backend/scripts`。
- 平台基线仍为不开放公开注册：无前端注册页、无开放注册 API。
- 当前仍未提供产品化“管理员批量导入用户”能力（后台页面/管理接口/Excel 上传）。
- 当前已提供运维脚本级 CSV 批量导入能力：`backend/scripts/import-users.ts`，用于离线导入账号。
- 连接串口径区分：应用运行读取 `MONGO_URI`；运维导入脚本读取 `MONGO_ADMIN_URI`。
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
│     │  │  ├─ request-ai-feedback.dto.ts
│     │  │  └─ submission-detail-response.dto.ts
│     │  ├─ task-course-labels.constants.ts
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
│  ├─ learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts
│  ├─ learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts
│  ├─ classroom-student-task-detail.e2e-spec.ts
│  ├─ classroom-weekly-report.e2e-spec.ts
│  ├─ course-overview.e2e-spec.ts
│  ├─ course-lifecycle.e2e-spec.ts
│  ├─ enrollments.authority-and-legacy.e2e-spec.ts
│  ├─ enrollment-only.regression.e2e-spec.ts
│  ├─ classroom-learning-trajectory.e2e-spec.ts
│  ├─ classroom-review-pack.e2e-spec.ts
│  ├─ classroom-process-assessment.e2e-spec.ts
│  ├─ classroom-task-deadline.e2e-spec.ts
│  ├─ classroom-export-snapshot.e2e-spec.ts
│  ├─ users-me.e2e-spec.ts
│  ├─ users-change-password.e2e-spec.ts
│  ├─ classroom-students.e2e-spec.ts
│  └─ classroom-task-submissions.e2e-spec.ts
└─ scripts/
   ├─ sync-indexes.ts
   └─ import-users.ts
```

版本策略引用：
- `docs/backend-architecture.md`
- 数据库治理补充：`docs/database-conventions.md`
- E2E 运行基线：`docs/e2e-testing.md`
- 联调与运行口径：`docs/handoff/handoff-config-matrix.md`

## 2) 领域模型摘要卡（按模块）

### Course（`src/modules/courses/schemas/course.schema.ts`）
- 关键字段：`code`、`name`、`term`、`courseLabel?`、`status(ACTIVE|ARCHIVED)`、`createdBy`。
- `courseLabel` 语义：可选课程分类字段（与 `Task.courseLabel` 共用 `task-course-labels.constants.ts` 值域）；非外键、可为空；用于课程与模板的分类坐标对齐。
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
- 关键字段：`classroomId`、`taskId`、`status(ACTIVE|CLOSED|RECALLED)`、`publishedAt`、`dueAt?`、`settings.allowLate?`、`settings.maxAttempts?`、`createdBy`。
- 索引/唯一性：`unique(classroomId, taskId)`；`(classroomId, createdAt)`。
- 生命周期口径：新发布默认 `ACTIVE`；允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`；撤回（`RECALLED`）要求当前“无提交”，有提交时只能关闭（`CLOSED`）；`RECALLED` 保持封闭不可恢复，且 `CLOSED -> RECALLED` 不允许；旧数据缺省状态按 `ACTIVE` 兼容读取。
- 实例级配置口径：新增 `PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId`，仅允许更新 `dueAt/settings.allowLate/settings.maxAttempts`；`ACTIVE/CLOSED` 可编辑，`RECALLED` 不可编辑；状态流仍走独立 `/status` 接口。
- 提交门禁：`ClassroomTask.status` 非 `ACTIVE` 时拒绝新提交；`settings.allowLate` 默认按实现为 `true`，迟交标记仍按 `dueAt/allowLate` 计算。

### Task（`src/modules/learning-tasks/schemas/task.schema.ts`）
- 关键字段：`title`、`description`、`knowledgeModule`、`courseLabel?`、`visibility(PRIVATE|SHARED)`、`stage(1..4)`、`difficulty?`、`rubric?`、`status(DRAFT|PUBLISHED|ARCHIVED)`、`createdBy`、`publishedAt?`。
- `courseLabel` 语义：可选单值课程分类字段（白名单来源 `task-course-labels.constants.ts`）；非 `Course` 外键；仅用于模板治理（筛选/分组/展示辅助）；不参与权限与发布约束。
- `visibility` 语义：模板可见性字段（白名单来源 `task-template-visibility.constants.ts`）；新建默认 `PRIVATE`；旧数据缺省值按 `SHARED` 兼容解释；共享仅影响读可见性，不改变作者写权限。
- 索引/唯一性：`(createdBy,createdAt)`；`(status,knowledgeModule,stage,createdAt)`；`(status,courseLabel,createdAt)`；`(visibility,createdAt)`；`(createdBy,status,courseLabel,knowledgeModule,stage,updatedAt,createdAt)`（发布候选 onlyMine 分支）；`(visibility,status,courseLabel,knowledgeModule,stage,updatedAt,createdAt)`（发布候选 shared 可见分支）。

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
- 关键字段：`submissionId`、`createdBy?`、`source(AI|TEACHER|SYSTEM)`、`type(...)`、`severity(INFO|WARN|ERROR)`、`message`、`suggestion?`、`tags?`、`scoreHint?`。
- 索引/唯一性：`unique(submissionId,source,type,severity,message)`；`(submissionId,createdAt)`；`(submissionId,source,createdAt)`。
- 隔离字段来源：当前 schema 无 `classroomTaskId` 直连字段；统计隔离通过 `submissionId -> Submission.classroomTaskId` 关联完成。

### User（`src/modules/users/schemas/user.schema.ts`）
- 关键字段：`email`、`passwordHash(select:false)`、`roles[]`、`status(active|suspended)`、`name?`、`studentNo?`、`employeeNo?`。
- 索引/唯一性：`unique(email)`。
- 用户资料口径：`GET/PATCH /api/users/me` 返回一致的公开字段口径，不返回 `passwordHash`。
- 账户安全动作：`POST /api/users/me/change-password` 仅允许当前会话用户改密；成功后保留当前会话并失效其它历史会话。

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
- `ai-feedback.prompt.ts`
- `openrouter-feedback.provider.ts`

规则摘要：
- 顶层只允许 `items`（必需）与 `meta`（可选）。
- 每个 item 只允许 `type,severity,message,suggestion,tags,scoreHint`。
- `type/severity` 必须来自枚举值域；`message` 必须非空。
- `tags` 必须来自统一词表；未知值归一化为 `other`。
- 返回必须是单个 JSON 对象（禁止 markdown/code fence/额外字段）。
- JSON 协议本身未变；本轮变化在 provider 输入契约（`AiSubmissionAnalysisContext`）与 prompt 约束层（task 上下文 + 默认简体中文输出）。

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
  - `LEARNING_TASK_SUBMISSION_COOLDOWN_MS`
  - `AI_FEEDBACK_WORKER_INTERVAL_MS`
  - `AI_FEEDBACK_WORKER_BATCH_SIZE`
  - `OPENROUTER_API_KEY`（仅 `openrouter + real enabled` 必填）
  - `BAILIAN_API_KEY`（仅 `bailian + real enabled` 必填）
- 业务口径补充：Enrollment-only 已收口，legacy `studentIds` 不存在 fallback（该条为业务规则，不是 env 开关）。

### 3.5 providers 子目录提炼

| Provider | 文件 | 说明 |
|---|---|---|
| Stub Provider | `default-stub-ai-feedback.provider.ts` | 已适配统一契约 `analyzeSubmission(context: AiSubmissionAnalysisContext)`；仍仅基于 `context.codeText` 走本地规则，英文输出与规则行为不变 |
| OpenRouter Provider | `providers/real/openrouter-feedback.provider.ts` | 已接收 `AiSubmissionAnalysisContext`；prompt 纳入 `taskTitle/taskDescription/taskRubric/codeText` 等上下文；默认要求反馈文本（`message/suggestion`）使用简体中文，并以“主问题导向综合反馈”为主控（默认 1 条、仅独立问题允许第 2 条、同类问题禁止按位置拆条）；空数组仅在“确实无任何可反馈/可建议内容”时允许，基本正确但可改进仍返回 1 条综合反馈；`language` 仅视为 hint，若 hint 缺失/auto/unknown 或与代码冲突，优先依据代码特征判断语言；provider 协议层对 `items` 执行 `<=2` 闸门；外部 AI 调用 + 严格 JSON 解析 |
| Bailian Provider | `providers/real/bailian-feedback.provider.ts` | 新增阿里云百炼 provider，通过 `AI_FEEDBACK_PROVIDER=bailian` 启用；默认 `BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`BAILIAN_MODEL=qwen-plus`（生产可显式指定 `qwen3.6-plus`）；走 OpenAI Chat Completions 兼容接口 `/chat/completions`；复用 OpenAI-compatible 基类中的 prompt、严格 JSON 协议、字段白名单、`<=2` 闸门、重试、超时和错误映射；日志 provider 字段为 `bailian` |
| OpenAI Provider（占位） | `providers/real/openai-feedback.provider.ts` | 已同步统一 context 契约签名，但仍为占位实现（调用直接抛未实现错误） |

## 4) 关键链路概览（隔离口径）

- 主链路：`Course -> Classroom -> Enrollment -> ClassroomTask -> Submission -> AiFeedbackJob -> Feedback -> Dashboard/Report/Export`。
- 成员关系：Enrollment（`ACTIVE/REMOVED`）为唯一权威来源；所有授权/统计只读 Enrollment。
- 关键隔离键：`classroomTaskId`（提交、队列、报表、复盘、导出均按该维度隔离/聚合）。
- `Classroom.studentIds` 仅为 legacy 输出/镜像；系统授权、统计与 mine 查询均不读该字段（Enrollment only）。
- `AiFeedbackStatus=NOT_REQUESTED` 的两类来源（从未创建 job / 策略跳过入队）均为正常产品语义。
- AI feedback provider 契约已统一为 `analyzeSubmission(context: AiSubmissionAnalysisContext)`；`AiFeedbackProcessor` 在消费 job 时会先读取 submission，再按 `submission.taskId` 查询 task 并组装上下文后调用 provider（task 缺失进入失败链路）；主控约束已前移到 prompt/协议层（默认 1 条、必要时最多 2 条），processor compactor 继续作为轻量兜底。

新增/变更产品能力（Z3、AA~AI、Z4~Z9 收口口径）：
- P1 班级归档/删除契约（后端阶段一已完成，前端待后续阶段接入）：
  - 状态口径：`Classroom.status` 仅 `ACTIVE | ARCHIVED`，支持通过 `PATCH /api/classrooms/:id` 的 `status` 字段执行归档/恢复。
  - 兼容接口：保留 `POST /api/classrooms/:id/archive`，内部已收口到统一状态更新链路。
  - 新增删除接口：`DELETE /api/classrooms/:id`（teacher only + owner only）。
  - 删除允许条件（主规则）：`ClassroomTask.exists({ classroomId }) === false` 且 `Enrollment.exists({ classroomId }) === false`。
  - 删除禁止条件：存在任一 `ClassroomTask` 或任一 `Enrollment`（包括 `REMOVED` 历史）即不可删，只能归档。
  - 辅助一致性校验：`studentIds` 仅作防御性检查，不作为唯一主判定来源。
  - 非空删除错误口径：`409 Conflict`，`code=CLASSROOM_NOT_EMPTY`，message=`该班级已有成员或任务记录，不能删除，只能归档`。
- P1 课程归档/删除契约（后端阶段一已完成，前端待后续阶段接入）：
  - 状态口径：`Course.status` 仅 `ACTIVE | ARCHIVED`，支持通过 `PATCH /api/courses/:id` 的 `status` 字段执行归档/恢复。
  - 兼容接口：保留 `POST /api/courses/:id/archive`，内部已收口到统一状态更新链路。
  - 新增删除接口：`DELETE /api/courses/:id`（teacher only + owner only）。
  - 删除允许条件：`Classroom.exists({ courseId }) === false`。
  - 删除禁止条件：存在任一 `Classroom` 引用课程即不可删，只能归档。
  - 非空删除错误口径：`409 Conflict`，`code=COURSE_NOT_EMPTY`，message=`该课程下已有班级记录，不能删除，只能归档`。
- P1 课堂任务生命周期状态流契约（后端已完成，前端待后续阶段接入）：
  - `ClassroomTask` 新增状态字段：`ACTIVE | CLOSED | RECALLED`，默认 `ACTIVE`。
  - 新增状态流转接口：`PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId/status`（教师端）。
  - 流转规则：允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`；`RECALLED` 前必须无提交；`RECALLED` 保持封闭不可恢复，且 `CLOSED -> RECALLED` 不允许。
  - 恢复提交语义：`CLOSED -> ACTIVE` 仅恢复状态，不自动修改 `dueAt/settings.allowLate/settings.maxAttempts`。
  - 前端现状说明：课堂任务页已接入“关闭任务”，`CLOSED -> ACTIVE` 的“恢复提交”按钮尚未接入（后端契约已可用）。
  - 提交门禁同步：`CLOSED/RECALLED` 状态下学生提交入口拒绝新提交。
  - 保持边界：不做物理删除、不放宽 `unique(classroomId,taskId)`，本阶段不支持同模板同班级重复发布。
- P1 课堂任务实例级参数编辑契约（后端已完成，前端待后续阶段接入）：
  - 新增实例配置更新接口：`PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId`（教师端）。
  - 仅允许修改：`dueAt`、`settings.allowLate`、`settings.maxAttempts`；不允许修改 `taskId/classroomId/publishedAt/createdBy/status`。
  - 状态边界：`ACTIVE/CLOSED` 允许编辑，`RECALLED` 拒绝编辑；状态流仍由 `PATCH .../status` 独立承载。
  - 字段清空语义：`dueAt` 与 `maxAttempts` 支持 `null/空字符串` 清空（后端收敛为 unset），不落脏值。
- P1 发布候选模板查询索引补强（后端已完成）：
  - `Task` 新增两组复合索引，分别覆盖发布候选查询的 `onlyMine` 分支与共享可见分支。
  - 本次仅补强索引，不改接口契约、不改查询逻辑、不改前端接入口径。
- P1 班级发布候选查询契约升级（后端已完成，前端待后续阶段接入）：
  - 新增 `GET /api/classrooms/:id/publishable-task-templates`，专用于班级发布页候选模板分页查询。
  - 固定内置规则：只返回当前教师可见模板（自己私有+自己共享+他人共享）、只返回 `status=PUBLISHED`、自动排除当前班级已发布过的 `taskId`。
  - 支持 query：`courseLabel`、`onlyMine`、`knowledgeModule`、`stage`、`page`、`limit`。
  - 当请求未显式传 `courseLabel` 且班级所属课程存在 `courseLabel` 时，默认排序优先课程分类匹配模板，再按 `updatedAt/createdAt` 倒序。
- P1 Course 课程分类字段契约（后端已完成，前端待后续阶段接入）：
  - `Course.courseLabel` 已接入 schema/DTO/service/response，字段可选，空白输入会 trim 并按未设置处理。
  - `Course.courseLabel` 与 `Task.courseLabel` 共用同一套标准值域，保持“课程分类坐标”一致，未引入 `Task -> Course` 外键绑定。
- P1 Task 课程分类契约（后端已完成，前端待后续阶段接入）：
  - `Task.courseLabel` 已接入 schema/DTO/service/query/response；支持创建、更新、详情返回、列表返回与按标签筛选。
  - 字段保持可选，空值语义为“未分类/通用模板”；旧数据不做迁移脚本，保持兼容。
  - `courseLabel` 仅用于任务模板治理，不参与权限、不参与发布到班级一致性校验，不限制跨课程复用。
- P1 Task 模板可见性与视图范围契约（后端已完成，前端待后续阶段接入）：
  - `Task.visibility` 已接入 schema/DTO/service/query/response；值域 `PRIVATE|SHARED`，新建默认 `PRIVATE`。
  - 旧任务缺省 `visibility` 按 `SHARED` 兼容，避免历史模板在升级后大面积隐身。
  - 列表 query 新增 `scope(mine|shared|all)`，默认 `mine`（默认行为已从“公共池倾向”切换为“只看我的模板”）。
  - `scope` 语义：`mine=我的全部模板`；`shared=共享池(包含我自己设为 SHARED 的模板)`；`all=我的全部+共享池`。
  - 模板详情读取同步可见性：作者可读、他人仅可读 `SHARED`（含旧数据兼容）、他人 `PRIVATE` 不可读。
  - 共享仅影响读可见性，不改变“编辑/发布仍为作者权限”的所有权边界。
- P1 任务模板列表检索契约升级（后端已完成，前端待后续阶段接入）：
  - `GET /api/learning-tasks/tasks` 已将 `status/knowledgeModule/stage` 正式纳入数据库级过滤，并可与 `scope/courseLabel/page/limit` 叠加。
  - 保持原有分页结构与默认排序不变；本次仅升级后端查询契约，前端后续再把这三项从本地过滤切换到 query 透传。
- P0 用户资料闭环（已完成）：
  - `PATCH /api/users/me`：已落地可用；仅允许更新 `name/studentNo/employeeNo`。
  - `GET /api/users/me` 与 `PATCH /api/users/me` 返回口径一致，均不返回 `passwordHash`。
  - `POST /api/users/me/change-password`：已落地可用；需校验 `currentPassword`，`newPassword` 执行 trim 非空与长度校验，且不得与当前密码相同；成功后保留当前会话并失效其它历史会话。
- P0 班级成员列表（已完成）：
  - `GET /api/classrooms/:id/students`
  - teacher owner 可访问；成员来源只认 Enrollment（`role=STUDENT`）；默认返回 ACTIVE，`includeRemoved=1/true` 时返回 ACTIVE+REMOVED；默认排序 `joinedAt desc, _id desc`；不读取 `classroom.studentIds`。
- P0 课堂任务提交列表（已完成）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`
  - teacher owner 可访问；只按 `classroomTaskId` 读取；默认排序 `submittedAt desc, _id desc`；无 job 时 `aiFeedbackStatus=NOT_REQUESTED`；`items[*].feedbackCount` 为该 submission 在 Feedback 集合中的总条数（按当前页 submissionIds 批量聚合），无反馈返回 `0`；不返回 `passwordHash/content.codeText`。
- P0 提交详情稳定读源（已完成）：
  - `GET /api/learning-tasks/submissions/:id`
  - 学生本人可访问；若 `classroomTaskId` 存在，仅所属班级 owner teacher 可访问；若 `classroomTaskId` 为空，仅 task owner teacher 可访问。
  - 返回 submission detail 稳定读源字段（`taskTitle/studentName/content.language/content.codeText/submittedAt/attemptNo/isLate/lateBySeconds/aiFeedbackStatus`）。
  - 无 job 时 `aiFeedbackStatus=NOT_REQUESTED`。
- 教师反馈标签词表收口（已完成）：
  - `POST /api/learning-tasks/submissions/:id/feedback`
  - `tags` 与 AI feedback 共用统一词表（同 `feedback-normalizer` 词表来源）；包含未定义标签时返回 `400` + `Invalid tag(s), please select from predefined tags`。
  - `tags` 未传或清洗后为空时，后端按 `other` 持久化。
- 教师反馈修改契约（已完成）：
  - `PATCH /api/learning-tasks/submissions/:submissionId/feedback/:feedbackId`
  - 仅 teacher 可调用；教师管理权限与 submission detail 口径一致：有 `classroomTaskId` 时按课堂任务所属班级 owner teacher，缺省时按 task owner teacher。
  - 仅允许修改 `TEACHER` 来源反馈；`AI/SYSTEM` 反馈保持只读。
  - `Feedback.createdBy` 为 optional 兼容字段；新建 `TEACHER` 反馈写入当前教师，旧 `TEACHER` 反馈缺失时允许有管理权限的教师更新并补写。
- AI 默认联调模式（已固化）：
  - 推荐 `Stub + worker`：`AI_FEEDBACK_PROVIDER=stub` 且 `AI_FEEDBACK_WORKER_ENABLED=true`。
  - worker 轮询默认间隔为 `10000ms`（`AI_FEEDBACK_WORKER_INTERVAL_MS` 可覆盖）；空跑 tick（processed/succeeded/failed/dead 全 0）默认不输出结果 DEBUG 日志。
  - 产品级 request 仅负责创建/确保 job（新建时为 `PENDING`），worker 负责消费到 `SUCCEEDED`。
  - `process-once` 仅用于 debug/ops，不作为默认交付运行模式。
  - Real OpenRouter 路径已支持基于 task 上下文（`title/description/rubric`）分析 submission，且 prompt/协议已明确“默认 1 条、必要时最多 2 条、同类问题合并、错误优先、禁止表扬噪音”。
  - Real Bailian 路径已接入阿里云百炼 OpenAI-compatible 接口；OpenRouter 保留，provider 通过 `AI_FEEDBACK_PROVIDER=stub|openrouter|bailian` 切换。
  - Stub provider 已完成统一 context 契约签名适配，但规则逻辑与英文输出保持原样；OpenAI provider 当前仍为占位实现。
- AI 指标看板（已存在）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`
- Z3 学生端聚合详情：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`
- AA 班级周报（teacher）：
  - `GET /api/classrooms/:classroomId/weekly-report`
- AB 课程总览（teacher）：
  - `GET /api/courses/:courseId/overview`
  - 窗口契约：默认 `window=all`；后端兼容 `all/7d/24h/1h`；`all` 语义为无时间下界过滤。
  - 排序契约：兼容 `studentsCount/submissionRate/aiSuccessRate/pendingJobs/failedJobs`，并新增 `overallSubmissionCoverage`。
  - `items[*].submissionRate` 保持兼容语义：`distinctStudentsSubmitted / studentsCount`（至少提交过一次的学生覆盖率）。
  - `items[*].overallSubmissionCoverage` 新增主比较指标：`sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`；当分母为 0 返回 `0`。
  - `items[*].ai.aiSuccessRate` 空值口径收口：`jobsTotal=0 -> null`，`jobsTotal>0 -> succeededJobs/jobsTotal`。
- Z4 学习轨迹（teacher）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`
  - `items[*]` 已返回结构化学生公开信息 `student:{id,name,studentNo,email}`（兼容 `studentName`），且未提交学生同样返回该信息。
  - `includeAttempts=true` 时 `items[*].attempts[*]` 已返回 `feedbackCount`（Feedback 全来源总条数，AI/TEACHER/SYSTEM，不区分来源）；同一 attempt 下 `feedbackSummary.totalItems` 继续表示 AI 摘要条目数。
- Z5 课堂复盘包（teacher）：
  - `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`
  - Query：`window, topK, examplesPerTag`（已移除 `includeStudentTiers`、`includeTeacherScript`）
  - 响应核心域：`overview/commonIssues/examples/studentTiers`（已移除 `actionItems/teacherScript`）
  - `examples` 已收口为去重典型样例池：同一 feedback 命中多标签时仅出现一次（按 `feedbackId` 去重），并保留 `primaryTag/matchedTags/tags` 解释标签归属。
  - `topTags` 统计口径不变：多标签 feedback 仍按标签展开分别计数。
  - `studentTiers` 判定：成员集只取 Enrollment ACTIVE；窗口过滤以 `submission.createdAt` 为准；每个学生只看该 `classroomTaskId` 下窗口内最新提交；`good=AiFeedbackStatus.Succeeded 且 latestErrorCount=0`，`watch=其余已提交`，`notSubmitted=窗口内无提交`；`latestErrorCount` 仅统计该最新提交的 `AI+ERROR`。
  - `studentTiers.good/watch/notSubmitted[*]` 均返回可展示学生信息：`studentId/studentName/studentNo`（`studentName` 缺失回落 `未知学生`）。
- Z6 过程性评价（teacher）：
  - `GET /api/classrooms/:classroomId/process-assessment`
  - `GET /api/classrooms/:classroomId/process-assessment.csv`
  - `items[*]` 已返回可展示学生信息：`studentId/studentName/studentNo`（`studentName` 缺失回落 `未知学生`，`studentNo` 缺失返回 `null`）。
  - CSV 口径已对齐 JSON：列前置为 `studentName,studentNo,studentId,...`（保留 `studentId` 便于核对链路）。
- 统计窗口收口·阶段一（后端契约已落地，前端待跟进）：
  - 范围：`weekly-report`、`process-assessment`（含 CSV）、`learning-trajectory`、`review-pack`、`course-overview`。
  - 默认窗口：以上接口默认值统一为 `all`。
  - `all` 语义：当前资源边界内的全部可统计历史记录；实现为“无时间下界过滤”，非固定天数伪全量。
  - 后端兼容窗口：
    - 班级级：`weekly-report` 支持 `all/7d/30d/24h/1h`，`process-assessment` 支持 `all/7d/30d/term`。
    - 单任务级：`learning-trajectory` 与 `review-pack` 支持 `all/7d/24h/30d`。
    - 课程级：`course-overview` 支持 `all/7d/24h/1h`。
  - 前端状态：当前前端主展示与默认值尚未全部切换到上述新策略，下一阶段前端再收口。
  - 保护边界：`ai-metrics` 窗口集合保持 `1h/24h/7d`，本阶段未引入 `all`。
- Z7 截止/迟交：
  - 提交门禁：`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 在到期且不允许迟交时返回 `LATE_SUBMISSION_NOT_ALLOWED`
  - 提交冷却：默认 `LEARNING_TASK_SUBMISSION_COOLDOWN_MS=300000`；按同一 `studentId + classroomTaskId` 判定，命中时返回 `429` + `SUBMISSION_COOLDOWN_ACTIVE`（含 `retryAfterMs/retryAfterSeconds`），`0` 表示关闭冷却。
  - 迟交持久字段：`Submission.submittedAt / isLate / lateBySeconds`
  - late 维度已贯穿周报、课程总览、学习轨迹、复盘包、过程性评价、快照导出等聚合接口
- Z9 教学数据快照导出（teacher）：
  - `GET /api/classrooms/:classroomId/export/snapshot`
- 运维收口产物：
  - `docs/handoff/handoff-testing-playbook.md`

## 5) P0 后端补齐状态（交接边界）

已完成（可供前端/BFF 正式接入）：
- 用户资料字段补齐：`name/studentNo/employeeNo`。
- `/api/users/me` 更新能力：`PATCH` 真实可用，且与 `GET` 返回口径一致。
- 当前用户自助改密能力：`POST /api/users/me/change-password` 真实可用（旧密码校验 + 新密码校验 + 会话失效策略）。
- 班级正式成员列表：`GET /api/classrooms/:id/students`（Enrollment ACTIVE SoT）。
- 课堂任务实例提交列表：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`（`classroomTaskId` 隔离）。
- 提交详情稳定读源：`GET /api/learning-tasks/submissions/:id`（用于 Teacher/Student submission detail 主视图读取，不再主要依赖 query 透传）。

明确未完成（本阶段不包含）：
- 产品化管理员批量导入用户能力（后台页面/管理接口/Excel 上传）。
- 教师手工添加学生到班级。
- 提交/成员列表高级筛选与全文搜索。
- 额外导出能力（如提交列表 CSV）。

运维脚本补充说明（非产品化后台能力）：
- 脚本入口：`backend/scripts/import-users.ts`。
- npm 用法：`npm run import-users -- --file="..." [--dry-run] [--reset-password]`。
- 输入格式：仅支持 CSV（不支持 xlsx）。
- 典型用途：在“不开放注册”基线下，供运维/管理员离线批量导入用户账号。
- 初始化密码：`cqupt@ai`。
- 默认行为：已存在用户不重置密码；仅显式传入 `--reset-password` 时才重置。
- 支持 `--dry-run` 只校验与统计，不写库。
