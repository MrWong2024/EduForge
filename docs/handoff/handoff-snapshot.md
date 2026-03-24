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
- `openrouter-feedback.prompt.ts`
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
  - `AI_FEEDBACK_WORKER_INTERVAL_MS`
  - `AI_FEEDBACK_WORKER_BATCH_SIZE`
  - `OPENROUTER_API_KEY`（仅 `openrouter + real enabled` 必填）
- 业务口径补充：Enrollment-only 已收口，legacy `studentIds` 不存在 fallback（该条为业务规则，不是 env 开关）。

### 3.5 providers 子目录提炼

| Provider | 文件 | 说明 |
|---|---|---|
| Stub Provider | `default-stub-ai-feedback.provider.ts` | 已适配统一契约 `analyzeSubmission(context: AiSubmissionAnalysisContext)`；仍仅基于 `context.codeText` 走本地规则，英文输出与规则行为不变 |
| OpenRouter Provider | `providers/real/openrouter-feedback.provider.ts` | 已接收 `AiSubmissionAnalysisContext`；prompt 纳入 `taskTitle/taskDescription/taskRubric/codeText` 等上下文；默认要求反馈文本（`message/suggestion`）使用简体中文；外部 AI 调用 + 严格 JSON 解析 |
| OpenAI Provider（占位） | `providers/real/openai-feedback.provider.ts` | 已同步统一 context 契约签名，但仍为占位实现（调用直接抛未实现错误） |

## 4) 关键链路概览（隔离口径）

- 主链路：`Course -> Classroom -> Enrollment -> ClassroomTask -> Submission -> AiFeedbackJob -> Feedback -> Dashboard/Report/Export`。
- 成员关系：Enrollment（`ACTIVE/REMOVED`）为唯一权威来源；所有授权/统计只读 Enrollment。
- 关键隔离键：`classroomTaskId`（提交、队列、报表、复盘、导出均按该维度隔离/聚合）。
- `Classroom.studentIds` 仅为 legacy 输出/镜像；系统授权、统计与 mine 查询均不读该字段（Enrollment only）。
- `AiFeedbackStatus=NOT_REQUESTED` 的两类来源（从未创建 job / 策略跳过入队）均为正常产品语义。
- AI feedback provider 契约已统一为 `analyzeSubmission(context: AiSubmissionAnalysisContext)`；`AiFeedbackProcessor` 在消费 job 时会先读取 submission，再按 `submission.taskId` 查询 task 并组装上下文后调用 provider（task 缺失进入失败链路）。

新增/变更产品能力（Z3、AA~AI、Z4~Z9 收口口径）：
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
- AI 默认联调模式（已固化）：
  - 推荐 `Stub + worker`：`AI_FEEDBACK_PROVIDER=stub` 且 `AI_FEEDBACK_WORKER_ENABLED=true`。
  - 产品级 request 仅负责创建/确保 job（新建时为 `PENDING`），worker 负责消费到 `SUCCEEDED`。
  - `process-once` 仅用于 debug/ops，不作为默认交付运行模式。
  - Real OpenRouter 路径已支持基于 task 上下文（`title/description/rubric`）分析 submission，且 prompt 默认要求教学反馈文本使用简体中文。
  - Stub provider 已完成统一 context 契约签名适配，但规则逻辑与英文输出保持原样；OpenAI provider 当前仍为占位实现。
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
  - `items[*]` 已返回结构化学生公开信息 `student:{id,name,studentNo,email}`（兼容 `studentName`），且未提交学生同样返回该信息。
  - `includeAttempts=true` 时 `items[*].attempts[*]` 已返回 `feedbackCount`（Feedback 全来源总条数，AI/TEACHER/SYSTEM，不区分来源）；同一 attempt 下 `feedbackSummary.totalItems` 继续表示 AI 摘要条目数。
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
