# 服务职责地图（Service Cards）

## Scope / Owner

本文是后端内部 Service / Provider / Workflow 职责与边界的 Owner，回答“内部谁负责、状态与一致性如何保证”。用于改动前定位影响范围，具体实现以当前 `backend/` 源码或用户指定 commit 为准。

- 维护 Service / Provider / workflow location、domain responsibility、上下游依赖、Service 真正承担的授权/资源边界、state / consistency / idempotency、data isolation、transaction / compensation / recovery、重要 side effects、具有实际意义的性能架构、SoT 与非职责边界。
- 不作为 endpoint inventory、HTTP Method/Path、Controller-level Auth 矩阵、完整 DTO 字段、完整 public response shape、普通 HTTP error inventory、frontend behavior 或 testing evidence 的 Owner。
- “endpoint 对外做什么”由 [Backend API Map](./handoff-backend-api-map.md) 维护；“公开数据长什么样”由 [DTO / Public Data Contract Cheatsheet](./handoff-backend-dto-cheatsheet.md) 维护；本文只描述内部如何承担职责与不变量，跨层采用 `reference, don't restate`。
- 前端消费与展示从 [Frontend API Map](./handoff-frontend-api-map.md) 及对应前端 Owner 获取；测试证据见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 与 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)；配置事实见 [Config Matrix](./handoff-backend-config-matrix.md)。

定位范围：`backend/src/modules/**` 的 Service 与 Provider；本文件不是完整方法签名目录。

全局口径（SoT）：

- 成员关系：`Enrollment(role=STUDENT,status=ACTIVE)` 是唯一权威来源（Enrollment-only）。
- 隔离键：课堂分析/报表/复盘/导出统一按 `classroomTaskId` 隔离，禁止用 `taskId` 做跨班兜底聚合。
- `Classroom.studentIds`：仅 legacy 输出/镜像字段；授权与统计读路径不依赖该字段。

Global SoT 只保留理解跨 Service workflow 必需的稳定不变量，不追加 endpoint、DTO、前端或测试明细；已有专项 Owner 时优先引用。

## Service Card 模板

- Service / Provider: `源码位置`
- Domain / Responsibility: `领域与承担的职责`
- Upstream: `调用方与入口职责`
- Downstream / Dependencies: `下游协作与依赖`
- Consistency / State / Idempotency: `状态、不变量与重复调用约束`
- Isolation: `数据隔离与 Service 实际负责的资源边界`
- Side Effects: `重要读写或外部副作用`
- Important Performance / Recovery: `仅在适用时记录性能架构、事务、补偿与恢复`
- SoT: `源码或权威合同引用`
- Boundary / Non-responsibility: `不承担什么、交给哪个 Owner`

确有助于理解 workflow 时可补少量关键方法名；不要求完整 TypeScript 签名、逐字段 I/O Shape、HTTP error matrix 或 endpoint inventory。

## Maintenance

- 现有 Service / Provider 卡片已按当前 Owner 模板治理；后续新增或修改继续按职责、协作、内部不变量、隔离、副作用、恢复与非职责边界组织，不再使用旧式 I/O、完整签名或 HTTP error matrix。
- 每次更新先区分本层重要事实、其他 Owner 的重复合同与可直接定位的机械源码信息；只压缩后两类，保留内部状态、幂等、并发、补偿、恢复及 SoT。
- 跨层事实引用顶部对应 Owner；卡片编号与锚点作为稳定定位保留。未展开的数据合同以对应源码定位，不在本文件补建 DTO / response inventory。

## Service Card 01

- Service: `backend/src/modules/auth/services/auth.service.ts`
- Domain / Responsibility: Auth 与 Session 协作，校验登录凭据、注销会话并为认证 Guard 解析会话。
- Upstream: 认证入口；`SessionAuthGuard` 的登录态校验。
- Downstream / Dependencies: `UserModel`、`SessionModel`、`SessionService` 与共享密码 helper。
- Consistency / State / Idempotency: 凭据校验成功后委托 `SessionService` 创建会话并执行单用户会话上限；token 缺失或失效时返回 `null`，过期会话在验证时删除后返回 `null`。
- Isolation: 会话与用户身份按 `userId` 关联，不使用课堂任务隔离键。
- Side Effects: 登录/注销通过 SessionService 写入或删除会话；验证过程可删除过期会话。
- SoT: `backend/src/modules/auth/services/auth.service.ts`；`backend/src/modules/auth/schemas/session.schema.ts`；`backend/src/modules/auth/auth.constants.ts`。
- Boundary / Non-responsibility: 不承担角色授权；会话创建、淘汰及批量失效由 [Card 01A](#service-card-01a) 负责，公开认证合同见 [API Map](./handoff-backend-api-map.md#auth)。

## Service Card 01A

- Service: `backend/src/modules/auth/services/session.service.ts`
- Domain / Responsibility: Session 创建、单个注销与按用户批量失效。
- Upstream: `AuthService` 登录/注销，`UsersService` 改密，`PasswordResetService` 重置密码。
- Downstream / Dependencies: `SessionModel`、`randomBytes`。
- Consistency / State / Idempotency: 使用 `expiresAt` 与 TTL 索引；单用户最多保留 5 个会话；支持保留当前会话后删除其余会话，或清空全部会话。删除入口未收到 token 时 no-op。
- Isolation: 批量失效按 `userId`；被保留的当前 token 只用于该用户的排除条件。
- Side Effects: 模块初始化时确保 session 索引，创建随机会话并写库，注销或淘汰时删库。
- Important Performance / Recovery: 按 `createdAt desc` 排序并 `skip(5)` 取得超额会话后批量淘汰；过期/淘汰会话不再通过后续认证。
- SoT: `backend/src/modules/auth/services/session.service.ts`；`backend/src/modules/auth/schemas/session.schema.ts`。
- Boundary / Non-responsibility: 不校验业务角色或课堂权限；会话有效期与 Cookie 配置见 [Config Matrix](./handoff-backend-config-matrix.md)。

## Service Card 01B

- Service: `backend/src/modules/mail/mail.service.ts`
- Domain / Responsibility: 统一邮件发送与密码重置邮件组装。
- Upstream: `PasswordResetService`。
- Downstream / Dependencies: `ConfigService`、`Logger`、smtp 分支的 `nodemailer`。
- Consistency / State / Idempotency: log 分支仅记录 provider、收件人与主题，不记录正文、重置链接、token 或 SMTP 凭据；smtp 分支使用配置发件人。
- Side Effects: log 分支仅日志；smtp 分支发送外部邮件。
- Important Performance / Recovery: 仅 smtp 初始化时创建 transporter；缺少发件人或关键配置时 fail-fast。发送失败向调用方抛出，由调用方承担业务补偿。
- SoT: `backend/src/modules/mail/mail.service.ts`；`backend/src/config/env.validation.ts`；`backend/src/config/configuration.ts`。
- Boundary / Non-responsibility: 不管理 reset token 或 Session；配置条件、值及环境组合见 [Config Matrix](./handoff-backend-config-matrix.md#4-核心-env-列表与默认值)。

## Service Card 01C

- Service: `backend/src/modules/auth/services/password-reset.service.ts`
- Domain / Responsibility: 协调用户、一次性 reset token、邮件及 Session 的密码重置流程。
- Upstream: 忘记密码与重置密码入口。
- Downstream / Dependencies: `UserModel`、`PasswordResetTokenModel`、`MailService`、`SessionService`、`ConfigService` 与共享密码 helper。
- Consistency / State / Idempotency:
  - 仅可登录用户进入 token/邮件写链；不存在或不可登录用户不创建 token、不发邮件。按 `userId + createdAt` 检查 60 秒冷却，命中时不创建新 token、不失效旧 token、不发新邮件。
  - 数据库只存 `tokenHash`，明文 token 只进入邮件链接；未命中冷却时创建新 token 并失效同用户既有未用 token。
  - 重置时通过 `tokenHash` 定位，显式检查 `expiresAt/usedAt`；以未使用且未过期为条件原子消费 token，竞争未命中则拒绝继续改密。随后更新密码、失效该用户其余有效 token，并清空其全部 Session。
- Isolation: reset token、冷却和 Session 失效均按 `userId`。
- Side Effects: 初始化时确保 token 索引；写 token、发邮件、更新密码哈希、删除 Session。
- Important Performance / Recovery: TTL 负责后台清理，不替代业务有效性检查；发信失败记录错误并使本次新 token 失效。重置写链异常记录并报错，已消费 token 不会因此恢复；该顺序写链不是跨集合事务回滚。
- SoT: `backend/src/modules/auth/services/password-reset.service.ts`；`backend/src/modules/auth/schemas/password-reset-token.schema.ts`。
- Boundary / Non-responsibility: 防邮箱枚举的公开响应见 [API Map](./handoff-backend-api-map.md#auth)；输入校验定位该 Service 使用的密码 helper 与 Auth DTO，不在本卡复制消息和字段矩阵。

## Service Card 02

- Service: `backend/src/modules/users/services/users.service.ts`
- Domain / Responsibility: 当前用户资料读写、改密及其 Session 失效协调。
- Upstream: 用户资料与改密入口。
- Downstream / Dependencies: `UserModel`、`SessionService` 与共享密码 helper。
- Consistency / State / Idempotency: 改密前校验当前密码并复用新密码校验；成功后保留当前会话、失效其余历史会话。资料更新忽略 `undefined`，不会把未提交字段写入数据库。
- Isolation: 所有操作绑定当前会话用户；公开资料读取采用 `lean + select` 最小投影。
- Side Effects: 写资料、密码哈希；通过 `SessionService.clearUserSessions` 删除历史会话。
- SoT: `backend/src/modules/users/services/users.service.ts`；`backend/src/modules/users/schemas/user.schema.ts`；`backend/src/modules/auth/schemas/session.schema.ts`。
- Boundary / Non-responsibility: 公开可写字段、密码 validation 与安全暴露见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#users)；公开行为见 [API Map](./handoff-backend-api-map.md#users)。

## Service Card 03

- Service: `backend/src/modules/courses/services/courses.service.ts`
- Domain / Responsibility: 课程持久化、状态动作及空课程删除。
- Upstream: 课程管理入口。
- Downstream / Dependencies: `CourseModel`、`ClassroomModel`、`UserModel`。
- Consistency / State / Idempotency: `unique(createdBy,code)` 防重复课程；归档与恢复收口到统一状态更新链路，归档内容不可编辑。删除前必须确认 `Classroom.exists({ courseId })===false`。
- Isolation: Service 内 `ensureTeacher` 校验及 `createdBy` 归属过滤；课程分类只是分类坐标，不是额外实体绑定。
- Side Effects: 写入、更新或删除课程记录。
- Important Performance / Recovery: 分页查询与计数并行；重复键转为受控业务拒绝，不绕过唯一约束。
- SoT: `backend/src/modules/courses/services/courses.service.ts`；`backend/src/modules/courses/schemas/course.schema.ts`。
- Boundary / Non-responsibility: 生命周期与删除拒绝见 [API Map](./handoff-backend-api-map.md#courses)，字段归一化/白名单及分页合同见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#courses)。

## Service Card 04

- Service: `backend/src/modules/classrooms/services/classrooms.service.ts`
- Domain / Responsibility: 班级管理、加入/移除成员，以及看板、周报、过程性评价、导出与 AI 分析的委托入口。
- Upstream: 班级与班级统计入口。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`EnrollmentModel`、`CourseModel`、`UserModel`、`EnrollmentService`；教师/学生看板、周报、过程性评价、导出、AI Learning Analytics 专用 Service。
- Consistency / State / Idempotency:
  - joinCode 分配最多尝试 8 次；归档状态下禁止普通信息编辑，状态恢复走专用状态处理。
  - 空班级删除主判定为无 ClassroomTask 且无任何 Enrollment 历史（含 REMOVED）；`studentIds` 仅作防御性辅助，不能取代主判定。
  - join/remove 先通过 Enrollment upsert/update 写 ACTIVE/REMOVED，再按需更新 legacy `studentIds` 镜像；授权与统计不读镜像兜底。
- Isolation: Service 负责管理/加入角色及 `teacherId` 归属边界；成员判定委托 EnrollmentService。向统计 Service 委托前保留角色校验，下游按课堂任务隔离。
- Side Effects: 写班级与 Enrollment，按需同步成员镜像；统计委托本身不写业务数据。
- Important Performance / Recovery: 班级列表按页批量查 Course，成员列表按页批量查 User，避免 N+1；关联课程缺失不阻断班级读取。
- SoT: `backend/src/modules/classrooms/services/classrooms.service.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`；`backend/src/modules/classrooms/enrollments/schemas/enrollment.schema.ts`。
- Boundary / Non-responsibility: 不在入口 Service 重算专用报表；公开生命周期与成员读取行为见 [API Map](./handoff-backend-api-map.md#classrooms)，公开数据见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#classrooms)。

## Service Card 05

- Service: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`
- Domain / Responsibility: 聚合课堂任务进展、提交、AI 状态、tags 与归档建议。
- Upstream: `ClassroomsService.getDashboard`。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`FeedbackModel`、`AiFeedbackJobModel`、`UserModel`、`EnrollmentService`。
- Consistency / State / Idempotency:
  - 在聚合前按 ClassroomTask 状态白名单选任务，并在组装前防御过滤；summary 与任务统计使用同一最终任务集合。普通看板不以模板当前状态过滤既有实例。
  - 默认教学统计只纳入当前 ACTIVE Enrollment 学生的提交、迟交、AI 与 tags；移除学生的历史记录保留，但不进入这些统计。tags 仅取 AI 来源并保留 top 5；未请求数为 `max(0, submissionsCount-requestedCount)`，缺失聚合补零。
  - 归档建议只针对 ACTIVE 班级，要求无当前活跃任务、最近 30 天无学生提交且通过 30 天新班级保护；建议专用的活跃任务判定要求实例 ACTIVE、模板 PUBLISHED，且截止未超 30 天缓冲，或无截止但发布在 90 天内。该判定不受是否包含关闭任务影响。
- Isolation: 先校验班级 `teacherId`；后续提交/AI/tags 全部限定最终可见 `classroomTaskIds`。
- Side Effects: 只读聚合；归档建议不执行归档或其他写操作。
- Important Performance / Recovery: 多个 aggregate 并行并用 Map 合并；模板发布者按 `Task.createdBy` 批量查 User；无任务返回空聚合。
- SoT: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`。
- Boundary / Non-responsibility: 公开任务可见性与响应投影见 [API Map](./handoff-backend-api-map.md#classrooms)；不把归档建议判定混成普通看板过滤或自动生命周期动作。

## Service Card 06

- Service: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`
- Domain / Responsibility: 按学生有效成员关系组织当前学习任务，关联最新提交、AI 状态与完成态。
- Upstream: `ClassroomsService`，由其执行学生角色校验。
- Downstream / Dependencies: `ClassroomModel`、`CourseModel`、`ClassroomTaskModel`、`SubmissionModel`、`FeedbackModel`、`UserModel`、`AiFeedbackJobService`、`EnrollmentService`。
- Consistency / State / Idempotency: 先取得 ACTIVE Enrollment 班级，再筛选 ACTIVE 班级与 ACTIVE 实例；模板当前状态不参与运行态过滤。按公开的到期/历史时间规则形成最终任务集合，再分页班级分组；无可见任务的班级不形成空分组，total 从最终分组计算。
- Isolation: 提交与状态仅围绕最终返回的 `classroomTaskIds`；完成态只读取 `myLatestSubmission.submissionId` 的反馈，不按 taskId、classroomTaskId 或 studentId 粗聚合历史反馈。
- Side Effects: 只读。
- Important Performance / Recovery: 当前页班级的课程/教师批量查找，提交、job 状态及完成态批量计算。无提交保留空最新提交状态；无 job 使用 NOT_REQUESTED。完成态来源/严重度优先级同 [Card 08D](#service-card-08dfeature-my-task-detail-z3)。
- SoT: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`。
- Boundary / Non-responsibility: 公开历史窗口、状态展示及关联摘要的空值合同见 [API Map](./handoff-backend-api-map.md#classrooms)；不把模板资产状态当成学生运行态。

## Service Card 07

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`
- Domain / Responsibility: 发布与管理课堂任务实例，查询可发布模板，组织实例提交与 Z3/Z4 聚合。
- Upstream: 课堂任务管理、实例提交及实例聚合入口。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`TaskModel`、`SubmissionModel`、`FeedbackModel`、`UserModel`、`EnrollmentService`、`AiFeedbackJobService`、`LearningTasksService`。
- Consistency / State / Idempotency:
  - 发布前检查班级运行状态及模板已发布；`unique(classroomId,taskId)` 防重复发布，重复键转为受控拒绝。旧实例缺省状态按 ACTIVE 兼容。
  - 实例配置更新与生命周期分开处理；撤回前检查无提交，RECALLED 保持封闭。恢复提交仅改状态，不隐式改截止与提交设置；不支持撤回后重发同模板。
  - 发布候选查询同时应用当前教师可见性、模板发布状态及已发布 taskId 排除；未显式指定课程分类时按班级课程分类优先排序。
  - 提交入口检查学生身份、Enrollment ACTIVE、课堂归属及班级/实例 ACTIVE，再通过 `createSubmissionForClassroomTask` 绑定实例主键；真正写 Submission/自动 Job 前，由 [Card 08](#service-card-08) 再次 enforce 运行态及截止/迟交边界。
- Isolation: 查询与统计按 `classroomTaskId`，成员全集来自 Enrollment ACTIVE；不得按底层 taskId 跨班兜底。模板状态不决定既有实例学生运行态。
- Side Effects: 写 ClassroomTask；学生提交委托 LearningTasksService 写 Submission 并按策略入队。
- Important Performance / Recovery: 列表用 aggregate 构造页数据与计数；模板发布者批量查 User。提交列表按页批量关联公开用户信息、job 状态及全来源 feedbackCount，缺失计数补零，避免 N+1。
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`；`backend/src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`。
- Boundary / Non-responsibility: 完整状态转换/拒绝与 participationStatus 的公开合同见 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)，输入与返回数据见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#classroom-tasksclassrooms-子资源)。状态层 participation 判断不计算截止、迟交、冷却或 AI 动作资格；动作写入口仍是最终校验。

## Service Card 08

- Service: `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`
- Domain / Responsibility: 管理任务模板，创建 Submission，读取提交详情，写教师反馈，协调自动/手工 AI Job 与任务统计。
- Upstream: 任务/提交/反馈入口；`ClassroomTasksService` 的实例提交流程。
- Downstream / Dependencies: `ConfigService`、`TaskModel`、`SubmissionModel`、`FeedbackModel`、`ClassroomTaskModel`、`ClassroomModel`、`UserModel`、`AiFeedbackJobService`。
- Consistency / State / Idempotency:
  - 模板承担资产管理，ClassroomTask 承担教学运行态；内容编辑不得隐式改变状态，同状态输入忽略后继续编辑，归档内容不可改。重复发布保持幂等；归档不检查/级联 ClassroomTask 引用，兼容 restore 入口不恢复归档模板。
  - 模板读范围由当前教师与共享可见性构造；legacy 缺省 visibility 兼容 SHARED，兼容 createdBy query 不突破当前教师范围；共享不转移作者写权限。分类为治理坐标，不作为 Course 外键或发布一致性约束；“未分类”查询兼容字段缺省任务。
  - Submission 的 attemptNo 采用“查询最新编号 + 有界重试”，最多 3 次分配尝试，冲突不绕过唯一约束。通用任务提交要求模板已发布；实例提交在写 Submission/自动 Job 前重验班级/实例 ACTIVE，并校验截止与迟交规则，持久化提交时间及迟交结果，不以模板当前状态阻断既有实例。
  - 自动入队由提交是否触发及首提策略共同决定；手工请求复用 `ensureJobForSubmission`，不重复创建已有 Job。学生对本人实例提交手工请求前同样重验班级/实例运行态；教师手工请求保留资源管理边界。
  - 教师反馈修改复用 submission 管理上下文，校验反馈属于该提交、来源为 TEACHER 且已有作者与当前教师一致。旧教师反馈无 createdBy 时在授权更新中补写，不批量迁移历史数据。
- Isolation: 学生只访问本人 Submission；教师管理上下文在有 classroomTaskId 时沿实例定位班级 owner，否则沿 Task 定位作者。教师默认提交列表与计数共同过滤当前 Enrollment ACTIVE，移除学生历史记录保留；课堂链路保留 classroomTaskId，通用提交允许该键缺省。
- Side Effects: 写模板、Submission、Feedback；自动入队与手工确保 Job 分别委托 JobService。课堂提交冷却与自动入队的运行参数见 [Config Matrix](./handoff-backend-config-matrix.md)。
- Important Performance / Recovery: 列表筛选在数据库中组合执行；批量关联发布者与 Job 状态。发布候选复合索引分别以 `createdBy` 或 `visibility` 为前缀，后接 `status,courseLabel,knowledgeModule,stage,updatedAt,createdAt`，支持本人及共享分支；编号重试耗尽安全拒绝。
- SoT: `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`；`backend/src/modules/learning-tasks/schemas/task.schema.ts`；`backend/src/modules/learning-tasks/schemas/submission.schema.ts`；`backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`。
- Boundary / Non-responsibility: 公开生命周期、提交详情读源及 detail/list 内容暴露差异见 [API Map](./handoff-backend-api-map.md#learning-tasks)，字段/validation 见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#learning-tasks)；本 Service 不执行 Provider 推理，不用模板资产状态代替课堂运行态。

## Service Card 08A

- Service: `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Domain / Responsibility: 成员关系写入与成员列表、分页、计数、分组计数的权威读取。
- Upstream: 班级管理、任务授权及各聚合 Service。
- Downstream / Dependencies: `EnrollmentModel`。
- Consistency / State / Idempotency: enroll 使用幂等 upsert，并发重复键收敛到 ACTIVE；remove 软删除为 REMOVED 并写 removedAt，不删除历史关系。
- Isolation: 学生有效成员 SoT 为 `role=STUDENT,status=ACTIVE`；不读取 `classroom.studentIds` 兜底。
- Side Effects: 写 Enrollment 集合。
- Important Performance / Recovery: 提供带加入时间的分页读取与 grouped count，避免调用方逐班计数；并发重复键是收敛分支，不作为重复入班失败。
- SoT: `backend/src/modules/classrooms/enrollments/schemas/enrollment.schema.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`。
- Boundary / Non-responsibility: 调用方负责教师/学生角色及资源准入，本 Service 负责关系状态，不接管班级镜像或 HTTP 授权矩阵。

## Service Card 08B

- Service: `backend/src/modules/classrooms/services/teacher-classroom-weekly-report.service.ts`
- Domain / Responsibility: 计算班级进度、风险未提交成员及 AI 健康汇总。
- Upstream: `ClassroomsService`；Snapshot 通过 `getWeeklyReportByLowerBound` 复用聚合。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`EnrollmentService`、`AiFeedbackMetricsAggregator`。
- Consistency / State / Idempotency: 窗口过滤统一使用 createdAt；all 不拼 lowerBound；风险集合为有效成员全集减去去重已提交学生，迟交统计随同一任务/提交范围计算。空任务或空成员返回零值聚合。
- Isolation: 校验班级 owner；成员全集来自 Enrollment ACTIVE，任务/提交/AI 统计按 classroomId 与 classroomTaskId。
- Side Effects: 只读。
- Important Performance / Recovery: 以 classroomTaskIds 批次聚合，避免逐 task 查询。
- SoT: `backend/src/modules/classrooms/services/teacher-classroom-weekly-report.service.ts`。
- Boundary / Non-responsibility: 窗口兼容集合、参数及公开数据见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口)，endpoint 合同见 [API Map](./handoff-backend-api-map.md#classrooms)。

## Service Card 08C

- Service: `backend/src/modules/courses/services/course-overview.service.ts`
- Domain / Responsibility: 将班级进度、提交、迟交和 AI 指标归并为课程总览。
- Upstream: 课程总览入口。
- Downstream / Dependencies: `CourseModel`、`ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`EnrollmentService`、`AiFeedbackMetricsAggregator`。
- Consistency / State / Idempotency: 先按课堂任务关联统计再归并到班级；all 时任务、提交与 Job 不拼时间下界；保留迟交统计。空班级页返回空聚合。
- Isolation: 校验 course.createdBy 与当前教师一致；仅纳入该教师名下 classrooms；成员数从 EnrollmentService 批量取得，禁止跨班 taskId 兜底。
- Side Effects: 只读。
- Important Performance / Recovery: 先分页 classrooms，再做 page-scope 聚合与页内排序，非全量排序。
- SoT: `backend/src/modules/courses/services/course-overview.service.ts`；`backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`。
- Boundary / Non-responsibility: 覆盖率、提交率与成功率的公开字段公式、零值/null 及 Query 合同见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口)。

## Service Card 08D（Feature: My Task Detail, Z3）

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts#getMyTaskDetail`
- Domain / Responsibility: 组织学生当前实例提交、AI 状态、可选反馈预览及完成态。
- Upstream: 学生任务聚合详情入口。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`TaskModel`、`SubmissionModel`、`EnrollmentService`、`AiFeedbackJobService`、`FeedbackModel`。
- Consistency / State / Idempotency:
  - 完成态只对最新提交的完整 TEACHER/AI 反馈集合计算；SYSTEM 不参与，来源优先级 TEACHER > AI，同来源取最严重 ERROR > WARN > INFO。
  - 无最新提交得到 NOT_SUBMITTED；最新提交无上述来源反馈得到 NO_FEEDBACK；所选来源 INFO/WARN/ERROR 分别映射 QUALIFIED/QUALIFIED_WITH_WARNINGS/UNQUALIFIED。
  - 关闭反馈明细或截断 preview 不影响完成态计算；无 Job 为 NOT_REQUESTED，不能推成正在执行。
- Isolation: 校验学生及 Enrollment ACTIVE；全链路按 classroomTaskId，完成态只绑定 `latest.submissionId`，不混用历史 submissions 或其他实例。
- Side Effects: 只读。
- Important Performance / Recovery: AI 状态、反馈摘要/preview 批量并行；完成态单独读取最新提交的完整反馈，不复用被 feedbackLimit 截断的明细。
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`；`backend/src/modules/classrooms/classroom-tasks/dto/query-my-task-detail.dto.ts`。
- Boundary / Non-responsibility: 不把展示 preview 当成状态计算 SoT；公开 participationStatus 与动作边界见 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)，本卡只维护完成态推导与查询隔离。

## Service Card 08E（Feature: Learning Trajectory, Z4）

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts#getLearningTrajectory`
- Domain / Responsibility: 按学生汇总实例提交轨迹、可选 attempts 与 tag 明细。
- Upstream: 教师学习轨迹入口。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`UserModel`、`EnrollmentService`、`AiFeedbackJobService`、`FeedbackModel`。
- Consistency / State / Idempotency: all 不对 submissions 拼 createdAt 下界；未提交学生仍参与。先分页 Enrollment，再做 page-local sort。关闭 tag 明细时跳过 tags 展开聚合；attempt feedbackCount 按全来源计算，AI 摘要保持独立，缺失计数补零、缺 Job 使用 NOT_REQUESTED。
- Isolation: 校验班级 owner；成员取 Enrollment ACTIVE，全链路按 classroomTaskId，页内查询再限 studentIds。
- Side Effects: 只读。
- Important Performance / Recovery: 按页批量读取用户与提交，再按 submissionIds 批量取状态、AI 摘要和全来源反馈数，避免 N+1。
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`；`backend/src/modules/classrooms/classroom-tasks/dto/query-learning-trajectory.dto.ts`。
- Boundary / Non-responsibility: 公开窗口、分页上限、结构化学生信息与字段语义见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口) 和 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)；不把页内排序称为全局排序。

## Service Card 08F

- Service: `backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts`
- Domain / Responsibility: 构造复盘聚合、典型样例及 ACTIVE 学生分层；提供按 submissionIds/classroomTaskIds 聚合 common issues 的复用入口。
- Upstream: 教师课堂复盘入口；`ClassroomExportSnapshotService`。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`FeedbackModel`、`UserModel`、`EnrollmentService`、`AiFeedbackJobService`、`AiFeedbackMetricsAggregator`。
- Consistency / State / Idempotency: all 不为提交/Job/tags 拼 lowerBound；topTags 按标签展开计数，典型样例按 feedbackId 去重并保留标签归属。学生分层覆盖完整 ACTIVE 集合，不按预览条数截断。
- Isolation: 校验班级 owner；成员取 Enrollment ACTIVE，任务统计严格按 classroomTaskId。
- Side Effects: 只读。
- Important Performance / Recovery: 样例先按 `severityRank desc, createdAt desc` 排序并按 examplesPerTag 截断候选，再按 feedbackId 去重。
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts`；`backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts`。
- Boundary / Non-responsibility: 不负责前端折叠/展开；公开分层语义、样例安全暴露和窗口见 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源) 与 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口)。

## Service Card 08G

- Service: `backend/src/modules/classrooms/services/process-assessment.service.ts`
- Domain / Responsibility: 计算学生过程性指标、评分/风险、排序分页，并复用同一聚合生成 CSV。
- Upstream: 过程性评价 JSON/CSV 入口；Snapshot 经 `getProcessAssessmentForSnapshot` 复用。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`SubmissionModel`、`AiFeedbackJobModel`、`FeedbackModel`、`EnrollmentService`。
- Consistency / State / Idempotency:
  - 先按 classroomId 与 window 选择 tasks，再应用 excludedTaskIds 得到 effectiveTaskIds；提交、迟交、AI、反馈与 topTags 均按有效任务重新计算。all 不拼 tasks/submissions/feedback 的 lowerBound；不在课堂/窗口内的合法排除 id 自然无效果。
  - 提交迭代、AI 覆盖/成功按 studentId + classroomTaskId 去重；反馈均值取每名学生每个有效任务“最新一次有 AI 反馈项的提交”。INFO 只进入反馈总均值，WARN 按 0.5、ERROR 按 1 扣分。
  - 计分与公开响应复用同一 rubric 常量，权重见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口)。无有效任务或无提交时 score 为 0；排除全部任务仍返回 ACTIVE 学生，任务统计归零。
  - 风险判定顺序：无有效任务为 LOW；有任务但无提交为 HIGH；覆盖率 <0.4 或平均 ERROR >=2 为 HIGH；覆盖率 <0.8、平均 ERROR >=1 或平均 WARN >=2 为 MEDIUM；其余 LOW。
- Isolation: 校验班级 owner；成员全集与分页来自 Enrollment ACTIVE，所有聚合限定 effectiveTaskIds。
- Side Effects: 只读；临时排除条件不持久化，不修改教学记录。
- Important Performance / Recovery: Enrollment 稳定分页后页内排序；JSON 与 CSV 使用同一 payload，CSV 采用双引号转义并追加 UTF-8 BOM，不另建计分/窗口链。
- SoT: `backend/src/modules/classrooms/services/process-assessment.service.ts`；`backend/src/modules/classrooms/dto/query-process-assessment.dto.ts`。
- Boundary / Non-responsibility: 不维护完整公开字段/CSV 列清单或窗口枚举，分别见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口) 与 [API Map](./handoff-backend-api-map.md#classrooms)。

## Service Card 08H

- Service: `backend/src/modules/classrooms/services/classroom-export-snapshot.service.ts`
- Domain / Responsibility: 组合班级、成员、任务及已有聚合，生成受体积约束的教学快照。
- Upstream: 教学快照导出入口。
- Downstream / Dependencies: `ClassroomModel`、`CourseModel`、`ClassroomTaskModel`、`SubmissionModel`、`EnrollmentService`、`TeacherClassroomWeeklyReportService`、`ClassReviewPackService`、`ProcessAssessmentService`、`AiFeedbackMetricsAggregator`。
- Consistency / State / Idempotency: 复用 weekly/common issues/process assessment 聚合，不独立重写评分或统计；按成员/评价限制及是否包含逐任务数据做截断，并记录截断说明。
- Isolation: 校验班级 owner；成员来自 Enrollment ACTIVE，统计按 classroomId + classroomTaskId。
- Side Effects: 只读。
- Important Performance / Recovery: 复用聚合 Service 与 page-scope 截断，避免无界大对象导出。
- SoT: `backend/src/modules/classrooms/services/classroom-export-snapshot.service.ts`；`backend/src/modules/classrooms/dto/query-classroom-export-snapshot.dto.ts`。
- Boundary / Non-responsibility: 公开导出合同见 [API Map](./handoff-backend-api-map.md#classrooms)，具体输入/返回结构从 SoT 定位；本卡不维护 response shape 或第二套指标算法。

## Service Card 08I

- Service: `backend/src/modules/classrooms/services/ai-learning-analytics.service.ts`
- Domain / Responsibility: 解析有效任务，构造学生—课堂任务标准样本，再聚合班级/任务/学生分析并完成搜索筛选分页。
- Upstream: `ClassroomsService` 校验教师角色后委托总览、学生列表或详情计算。
- Downstream / Dependencies: `ClassroomModel`、`CourseModel`、`ClassroomTaskModel`、`TaskModel`、`SubmissionModel`、`AiFeedbackJobModel`、`FeedbackModel`、`UserModel`、`EnrollmentService`；同文件纯计算入口 `buildAiLearningAnalyticsStandardSamples`。
- Consistency / State / Idempotency:
  - 有效任务按 classroomId 与 ClassroomTask.publishedAt 窗口选取，再排除任务；按 `publishedAt asc, classroomTaskId asc` 稳定排序。任务入选后保留完整提交链，不再按窗口裁剪提交。
  - 每个 studentId + classroomTaskId 最多一个标准样本；提交顺序为 `attemptNo asc, submittedAt asc, submissionId asc`。requested 表示存在任意 Job，delivered 表示存在 SUCCEEDED Job；anchor 取顺序最早的成功 Job 所属提交，其 Job.updatedAt 作为反馈完成时间。
  - postSubmission 必须为 anchor 后第一条 attemptNo 更大且 submittedAt 严格晚于反馈完成时间的提交；质量可比的后续提交还必须有成功 Job。代码变化仅作 CRLF→LF 与整体 trim。
  - 质量代理按 ERROR + WARN×0.5，以半分整数计算；可比样本分别按 before>after、before=after=0、before=after>0、before<after 判改善、保持无问题、仍有问题但持平、恶化；不可比时负荷为空，不伪造零。两类持平只向 legacy STABLE 投影，stableCount 等于两类持平计数之和。
  - 学生 overallOutcome 由所有可比样本的 issueLoadDeltaHalfUnitsTotal 决定：无样本为 INSUFFICIENT_DATA，总和正/零/负分别为 IMPROVED_OVERALL/NO_NET_CHANGE/REGRESSED_OVERALL；growthTrend 仅对应映射为 INSUFFICIENT_DATA/IMPROVING/STABLE/DECLINING，不独立重算。净零允许改善与恶化抵消。
  - engagementStatus 按互斥顺序判断：未提交→已提交未请求→已请求未交付→已交付未重提→已重提不可比→质量可比；它表示当前范围内到达的最深阶段。
  - 比率按对应计数计算：AI 学生覆盖率 = requested 去重学生数 / ACTIVE 学生数；AI 任务覆盖率 = requested student-task / submitted student-task；交付率 = delivered / requested；重提交率 = resubmitted / delivered；代码变化率 = codeChanged / resubmitted；可比率 = comparable / delivered；改善/两类持平/恶化率 = 各对应结果数 / comparable。任务趋势沿用 student-task 分母，不计算班级级 distinct-student coverage；三个平均值只取 comparable。比例与平均值保留 4 位小数，零分母归零。
- Isolation: 专用 Service 用 `_id + teacherId` 查询课堂；学生详情要求当前课堂 ACTIVE Enrollment。Feedback 查询与计算均限定 AI 来源，Job/提交/反馈按 classroomTaskId，不能混入相同 taskId 的其他课堂。
- Side Effects: 全部只读；不写数据库，不调用 Provider 或 Worker。
- Important Performance / Recovery:
  - 先批量读取 owner 课堂、有效任务、ACTIVE 成员及公开上下文；学生按 `studentNo,studentName,studentId` 稳定排序。q 只对姓名/学号做 trim 后不区分大小写的内存子串匹配，不构造 Mongo regex，不搜索 studentId。
  - 无指标筛选（含 q-only）时先分页 q 结果，再仅为当前页加载 Submission/Job/AI Feedback；有 overallOutcome 或 engagementStatus 筛选时先对 q 候选批量构造 metrics，再做 AND 筛选、计数与分页，并复用已算结果。
  - q 后无候选时跳过样本查询；所有路径使用 projection、lean、批量查询与 Map 配对，避免按学生/任务 N+1；空任务、成员或样本稳定返回空/零值聚合。
- SoT: `backend/src/modules/classrooms/services/ai-learning-analytics.service.ts`；`backend/src/modules/classrooms/dto/query-ai-learning-analytics.dto.ts`；`backend/src/modules/classrooms/types/ai-learning-analytics.types.ts`。
- Boundary / Non-responsibility: 公开方法学版本、枚举/响应投影及解释边界见 [API Map](./handoff-backend-api-map.md#classrooms)，输入/返回类型从上述 SoT 定位；本卡保留内部配对与聚合算法，不将结果升级为成绩、能力或因果判断。

## Service Card 09

- Service: `backend/src/modules/learning-tasks/services/learning-tasks-reports.service.ts`
- Domain / Responsibility: 聚合通用 Task 的共性问题、类型与典型样例。
- Upstream: 任务共性问题报表入口。
- Downstream / Dependencies: `TaskModel`、`SubmissionModel`、`FeedbackModel`。
- Consistency / State / Idempotency: 统计仅纳入 AI/TEACHER 反馈；聚合 limit 收敛到 1..10，每个 tag 的样例最多 3 条；无反馈返回空聚合。
- Isolation: 校验任务作者；此通用模板报表按 taskId 选择 submissions，不属于课堂实例隔离报表。
- Side Effects: 只读。
- Important Performance / Recovery: 单次 aggregate + facet 同时形成 tags、types 与样例，避免重复扫描。
- SoT: `backend/src/modules/learning-tasks/services/learning-tasks-reports.service.ts`。
- Boundary / Non-responsibility: 不可把本卡的 taskId 范围复用为课堂报表的跨班 fallback；公开入口见 [API Map](./handoff-backend-api-map.md#learning-tasks)。

## Service Card 10

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`
- Domain / Responsibility: 自动入队、手工确保 Job、诊断查询与批量状态映射。
- Upstream: `LearningTasksService` 提交/手工请求，诊断读取入口及看板/提交查询。
- Downstream / Dependencies: `AiFeedbackJobModel`。
- Consistency / State / Idempotency: `unique(submissionId)` 防重复；创建 PENDING Job 并初始化最大尝试次数为 3。`ensureJobForSubmission` 先查既有 Job，创建遇并发重复键时回查返回；无 Job 由调用方回落 NOT_REQUESTED，未知 Job 状态映射 FAILED 并记录诊断日志。
- Isolation: Job 绑定 submissionId 并保留课堂任务关联；资源归属由 LearningTasksService 请求入口先行校验。
- Side Effects: 写 Job，记录重复或异常日志。
- Important Performance / Recovery: 自动 enqueue 遇重复键忽略并记 debug，其他写库异常记 error，不抛入 Submission 主链；显式 ensure 不吞掉非重复键错误。状态映射按 submissionIds 的 `$in` 批量读取，避免逐提交查询。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`；`backend/src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`；`backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum.ts`。
- Boundary / Non-responsibility: 不处理 Provider 执行与业务授权；诊断接口的公开查询合同见 [API Map](./handoff-backend-api-map.md#ai-feedback-debug--ops门禁接口)。

## Service Card 11

- Service: `backend/src/modules/classrooms/classroom-tasks/services/ai-metrics.service.ts`
- Domain / Responsibility: 聚合实例 AI Job、错误及 AI 反馈运行指标。
- Upstream: 课堂任务 AI metrics 入口。
- Downstream / Dependencies: `ClassroomModel`、`ClassroomTaskModel`、`AiFeedbackJobModel`、`FeedbackModel`。
- Consistency / State / Idempotency: Job 窗口按 updatedAt 过滤；反馈只取 AI 来源。当前 schema 缺少延迟计算所需数据，不以伪造值填充延迟指标。
- Isolation: 校验 classroom.teacherId 与实例归属；所有统计按 classroomTaskId，反馈必要时通过 submissions 关联隔离。
- Side Effects: 只读 aggregate。
- Important Performance / Recovery: 前置 `$match`；Job 与 Feedback 分别聚合，关闭 includeTags 时跳过 tags 分支，避免 N+1。
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/ai-metrics.service.ts`。
- Boundary / Non-responsibility: 不返回 Provider 原始响应或重建推理链；公开窗口与接口见 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)，字段映射从上述源码定位。

## Service Card 12

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-guards.service.ts`
- Domain / Responsibility: 为 Processor 的 Provider 调用提供进程内并发信号量与课堂任务软限流。
- Upstream: `AiFeedbackProcessor`，自动 Worker 与手工执行共同经过该层。
- Downstream / Dependencies: `ConfigService`。
- Consistency / State / Idempotency: acquire 排队取得许可，release 重复调用幂等忽略；限流按 60 秒窗口记时间戳，命中时返回 false，由 Processor 转为 RATE_LIMIT_LOCAL。配置读取无效时使用内部兜底。
- Isolation: 限流桶按 classroomTaskId，缺失时使用 `no-classroomTask` 桶；许可队列与限流状态仅在当前进程内共享。
- Side Effects: 修改内存队列与时间戳 Map，无持久化写入。
- Important Performance / Recovery: 窗口过滤与惰性清理，Map 过大时清理；信号量队列限制突发并发。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-guards.service.ts`；`backend/src/config/env.validation.ts`。
- Boundary / Non-responsibility: 不提供跨进程分布式限流；并发/限流参数及默认值见 [Config Matrix](./handoff-backend-config-matrix.md#4-核心-env-列表与默认值)。

## Service Card 13

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`
- Domain / Responsibility: 原子认领 Job、构造分析上下文、经护栏调用 Provider、收敛并持久化反馈、更新执行终态与重试时间。
- Upstream: `AiFeedbackWorker` 与受诊断门禁保护的手工 process-once，共用处理链。
- Downstream / Dependencies: `AiFeedbackJobModel`、`SubmissionModel`、`TaskModel`、`FeedbackModel`、`AI_FEEDBACK_PROVIDER_TOKEN`、`AiFeedbackGuardsService`、`ConfigService`、`feedback-item-compactor`。
- Consistency / State / Idempotency:
  - 通过 findOneAndUpdate 按 createdAt 顺序原子 claim，仅认领 PENDING/FAILED，锁 TTL 为 5 分钟；成功写回用 job id + lockOwner 条件并清理锁/失败信息。
  - 读取 Submission 后按 submission.taskId 读取 Task，形成 AiSubmissionAnalysisContext；调用 Provider 后在写库前以内存 compactor 收敛，同类问题合并，存在 ERROR/WARN 时去掉独立低价值 INFO。
  - 凭据错误 UNAUTHORIZED/MISSING_API_KEY 直接 DEAD；其他失败增加 attempts，耗尽 maxAttempts 后 DEAD，否则 FAILED 并设置 notBefore。退避从 30 秒指数增长，最大 10 分钟；本地/上游限流同样进入有界失败恢复，不绕过护栏。
- Isolation: 沿 Job 的 classroomTaskId 进入限流桶；成功条件写回校验认领者，不把 Worker 防重入当成 Job 跨入口互斥。
- Side Effects: 外部 Provider 调用、反馈写库、Job 状态/锁/错误/重试时间更新；Provider 调用及反馈持久化使用的信号量在 finally 释放。
- Important Performance / Recovery: `insertMany(ordered:false)` 批量写反馈并容忍重复键；Job 关联的 Submission/Task 缺失也走失败/重试/死亡链。Provider BAD_RESPONSE 进入失败处理，重复反馈不单独中断 Job；收敛过程不追加数据库 I/O。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`；`backend/src/modules/learning-tasks/ai-feedback/lib/feedback-item-compactor.ts`；`backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-provider.error-codes.ts`。
- Boundary / Non-responsibility: 不承担产品请求的资源授权或 Worker 调度；反馈主策略来自 prompt/protocol，compactor 是落库前轻量兜底。运行参数见 [Config Matrix](./handoff-backend-config-matrix.md)，Provider 规则见 [Card B](#provider-card-b)。

## Service Card 14

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`
- Domain / Responsibility: 按配置启动后台轮询，以批次委托 Processor，并管理自身定时器生命周期。
- Upstream: Nest 模块初始化/销毁生命周期。
- Downstream / Dependencies: `AiFeedbackProcessor`、`ConfigService`。
- Consistency / State / Idempotency: 仅启用时建立 interval；isRunning 防止本 Worker tick 重入，tick 的 finally 复位；模块销毁时清理 interval。
- Isolation: Job 认领与课堂隔离由 Processor 负责，Worker 不建立第二套锁或限流。
- Side Effects: 周期调度与诊断日志。
- Important Performance / Recovery: 批处理数量可配置；禁用时无轮询开销。Processor 抛错时捕获记录，轮询进程不因单个 tick 异常退出。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`；`backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`。
- Boundary / Non-responsibility: Worker 只控制自动消费，不是 Provider 或手工执行总开关；配置职责、validation 和默认值见 [Config Matrix](./handoff-backend-config-matrix.md#4-核心-env-列表与默认值)。

## Provider Card A

- Provider: `backend/src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider.ts`
- Domain / Responsibility: 基于单提交代码执行内存规则，并归一化成统一反馈项。
- Upstream: Processor 经 Provider 注入调用。
- Downstream / Dependencies: `feedback-normalizer`。
- Consistency / State / Idempotency: 仅读 context.codeText，复用空代码/短代码/TODO 规则与英文 message；空代码形成 validation 错误项，未命中规则形成 other INFO 项，输出统一经过 normalizeFeedbackItems。
- Isolation: 只处理当前提交内容，不自行查询课堂或数据库。
- Side Effects: 无外部 I/O。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider.ts`；`backend/src/modules/learning-tasks/ai-feedback/lib/feedback-normalizer.ts`。
- Boundary / Non-responsibility: 不执行真实推理，不承担 Job 状态或落库；Provider 选择见 [Config Matrix](./handoff-backend-config-matrix.md)。

## Provider Card B

- Provider: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-compatible-feedback-provider.base.ts`
- Domain / Responsibility: 为兼容协议 Provider 构建请求，组织 prompt，执行有界网络调用，并解析/校验反馈及映射 Provider 错误。
- Upstream: `BailianFeedbackProvider` 继承复用，Processor 提供分析上下文。
- Downstream / Dependencies: Provider 配置、`fetch`、prompt、JSON protocol 与 normalizer。
- Consistency / State / Idempotency:
  - 严格 JSON 与字段白名单，协议最多 2 条反馈并结合 maxItems 收敛；prompt 要求主问题导向，默认 1 条、必要时第 2 条，同类问题不按位置拆分，阻断运行问题优先，ERROR/WARN 存在时不输出表扬型 INFO。
  - system prompt 要求 message/suggestion 使用简体中文、保留代码元素原文；user prompt 纳入题目标题/描述/rubric、代码/语言、尝试次数和 AI 使用声明，要求结合题目分析。
  - 多文件文本识别仅由 prompt 引导，默认按普通单文件处理；标准边界为 `===== FILE: relative/path/FileName.ext =====`，容错识别关键词大小写、仅文件名和明显弱边界。只有强证据表明多文件且边界不清时才保守提示；CodeTruncated=true 时不假定末文件块完整。
- Isolation: 单提交分析，日志关联 submissionId/classroomTaskId/provider/model/duration/retried。
- Side Effects: 外部网络调用及诊断日志；不写业务数据库。
- Important Performance / Recovery: 单请求超时与有界指数退避；HTTP 429/5xx/超时按可重试错误处理，缺 Key 为不可重试 MISSING_API_KEY；非法 JSON/越界字段为 BAD_RESPONSE，解析失败终止本次 Provider 解析链。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-compatible-feedback-provider.base.ts`；`backend/src/modules/learning-tasks/ai-feedback/protocol/ai-feedback-json.protocol.ts`；`backend/src/modules/learning-tasks/ai-feedback/prompts/ai-feedback.prompt.ts`。
- Boundary / Non-responsibility: 不用后端正则拆分多文件，不新增 codeFiles 数据模型，不要求普通提交补 FILE 标记；不接管 Processor 的 Job 重试终态。具体配置值见 [Config Matrix](./handoff-backend-config-matrix.md)。

## Provider Card C

- Provider: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`
- Domain / Responsibility: 保留统一分析契约的 OpenAI 占位实现。
- Upstream: 仅保留内部 Provider 形状，当前不能完成真实分析。
- Consistency / State / Idempotency: 任意调用仍抛“未实现、需人工安装 SDK”的错误。
- Side Effects: 当前无外部调用。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`。
- Boundary / Non-responsibility: 文件存在不代表当前已接入或可选择 OpenAI；可用 Provider 由 [Config Matrix](./handoff-backend-config-matrix.md) 维护。

## Provider Card D

- Provider: `backend/src/modules/learning-tasks/ai-feedback/providers/real/bailian-feedback.provider.ts`
- Domain / Responsibility: 将 Bailian 配置适配到 OpenAI-compatible 基类，执行百炼分析。
- Upstream: Processor 经 Provider 注入调用。
- Downstream / Dependencies: `ConfigService`、OpenAI-compatible 基类及其 prompt/protocol/normalizer。
- Consistency / State / Idempotency: 复用 [Card B](#provider-card-b) 的严格 JSON、字段白名单、反馈条数闸门、超时、退避及错误映射，不维护另一套解析与重试逻辑。
- Isolation: 日志沿用提交/课堂任务上下文并标明 provider=bailian。
- Side Effects: 经基类发起外部调用，无独立业务数据库写入。
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/bailian-feedback.provider.ts`；`backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-compatible-feedback-provider.base.ts`；`backend/src/modules/learning-tasks/ai-feedback/protocol/ai-feedback-json.protocol.ts`；`backend/src/modules/learning-tasks/ai-feedback/prompts/ai-feedback.prompt.ts`。
- Boundary / Non-responsibility: Base URL、model、Key 条件与环境配置见 [Config Matrix](./handoff-backend-config-matrix.md)，本卡不复制配置默认值或完整 Provider 错误表。
