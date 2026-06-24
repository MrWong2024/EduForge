# 服务职责地图（Service Cards）

扫描范围：`backend/src/modules/**` 下全部 `*service.ts`。  
补充：为满足 Provider 交接完整性，附带 `*.provider.ts` 卡片。
重点包含：`classrooms/enrollments/services/*` 与 `classrooms/classroom-tasks/services/*` 新增服务域。

全局口径（SoT）：

- 成员关系：`Enrollment(role=STUDENT,status=ACTIVE)` 是唯一权威来源（Enrollment-only）。
- 隔离键：课堂分析/报表/复盘/导出统一按 `classroomTaskId` 隔离，禁止用 `taskId` 做跨班兜底聚合。
- `Classroom.studentIds`：仅 legacy 输出/镜像字段；授权与统计读路径不依赖该字段。

## Service Card 模板（含新增字段）

- Service: `<file path>`
- Domain: `Course|Classroom|ClassroomTask|Task|Submission|AiFeedbackJob|Feedback|Cross-domain`
- Actions: `2~4 个动词`
- I/O Shape:
  - In: `关键参数`
  - Out: `entity | paged list | aggregate | void`
- Key Methods（关键方法签名摘要）
- AuthZ Boundary
- Metrics/Isolation
- Consistency/Constraints
- Deps/Side Effects
- Performance Notes
- SoT
- Failure Modes

## Service Card 01

- Service: `backend/src/modules/auth/services/auth.service.ts`
- Domain: `Cross-domain(Auth + Session)`
- Actions: `login`, `logout`, `validate-session`
- I/O Shape:
  - In: `LoginDto(email,password)`, `token`
  - Out: `sessionToken + user profile` | `void` | `{ id, roles } | null`
- Key Methods:
  - `login(dto: LoginDto): Promise<{ sessionToken: string; user: Record<string, unknown> }> — called by auth login controller`
  - `logout(token?: string): Promise<void> — called by auth logout controller`
  - `validateSession(token?: string): Promise<{ id: string; roles: string[] } | null> — called by SessionAuthGuard for request authentication`
- AuthZ Boundary: `login-only`（由 controller/guard 接入；不做角色鉴权）
- Metrics/Isolation: 会话治理按 `userId`，与 `classroomTaskId` 无关
- Consistency/Constraints: 登录凭据校验后通过 `SessionService` 创建 session；保持会话上限 `N=5`
- Deps/Side Effects: `UserModel`, `SessionModel`, `SessionService`, 共享密码 helper；写入/删除 sessions
- Performance Notes: session 创建/淘汰逻辑下沉到 `SessionService`
- SoT: `docs/auth-baseline.md`; `backend/src/modules/auth/schemas/session.schema.ts`; `backend/src/modules/auth/auth.constants.ts`
- Failure Modes:
  - 凭据错误 -> `401 Unauthorized`
  - token 缺失/失效 -> `validateSession` 返回 `null`
  - session 过期 -> 删除会话并返回 `null`

## Service Card 01A

- Service: `backend/src/modules/auth/services/session.service.ts`
- Domain: `Session`
- Actions: `create-session`, `delete-session`, `clear-user-sessions`
- I/O Shape:
  - In: `userId`, `token?`, `currentSessionToken?`
  - Out: `sessionToken | void`
- Key Methods:
  - `onModuleInit(): Promise<void> — called by Nest lifecycle to ensure session indexes exist`
  - `createUserSession(userId: ObjectId): Promise<string> — called by AuthService.login`
  - `deleteSession(token?: string): Promise<void> — called by AuthService.logout`
  - `clearUserSessions(userId: ObjectId|string, currentSessionToken?: string): Promise<void> — called by UsersService.changePassword and PasswordResetService.resetPassword`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 会话治理按 `userId`
- Consistency/Constraints: `expiresAt` + TTL 索引；单用户最多保留 5 个会话；支持“保留当前会话”与“清空全部会话”两种失效策略
- Deps/Side Effects: `SessionModel`, `randomBytes`；写 session、删 session、ensureIndexes
- Performance Notes: 旧会话清理用 `sort(createdAt:-1)+skip(5)` 一次性淘汰
- SoT: `backend/src/modules/auth/services/session.service.ts`; `backend/src/modules/auth/schemas/session.schema.ts`
- Failure Modes:
  - token 缺失 -> 删除动作直接 no-op
  - session 过期/淘汰 -> 下次校验返回 `null`

## Service Card 01B

- Service: `backend/src/modules/mail/mail.service.ts`
- Domain: `Cross-domain(Mail)`
- Actions: `send-mail`, `send-password-reset-email`
- I/O Shape:
  - In: `to/subject/text/html` 或 `to/resetUrl/expiresInMinutes`
  - Out: `void`
- Key Methods:
  - `sendMail(options): Promise<void> — called by PasswordResetService`
  - `sendPasswordResetEmail(options): Promise<void> — called by PasswordResetService.requestPasswordReset`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 与 `classroomTaskId` 无关
- Consistency/Constraints: 支持 `MAIL_PROVIDER=log|smtp`；`log` 仅打日志不真实发送；`smtp` 必须通过配置构造 `"Display Name" <from@example.com>` 发件人；不得记录 `SMTP_PASS`
- Deps/Side Effects: `ConfigService`, `Logger`, `nodemailer`（仅 smtp provider）
- Performance Notes: smtp transporter 在 service 初始化时创建；缺失关键 SMTP 配置时 fail-fast
- SoT: `backend/src/modules/mail/mail.service.ts`; `backend/src/config/env.validation.ts`; `backend/src/config/configuration.ts`
- Failure Modes:
  - `MAIL_PROVIDER=smtp` 且缺失 SMTP 关键配置 -> 抛配置错误
  - SMTP 发送失败 -> 抛异常，由上层决定补偿/日志口径

## Service Card 01C

- Service: `backend/src/modules/auth/services/password-reset.service.ts`
- Domain: `Cross-domain(Auth + User + Mail + Session)`
- Actions: `request-password-reset`, `reset-password`, `invalidate-tokens`
- I/O Shape:
  - In: `email` 或 `token + newPassword`
  - Out: `{ message: string }`
- Key Methods:
  - `onModuleInit(): Promise<void> — called by Nest lifecycle to ensure password-reset-token indexes exist`
  - `requestPasswordReset(email: string): Promise<{ message: string }> — called by POST /auth/forgot-password`
  - `resetPassword(token: string, newPassword: string): Promise<{ message: string }> — called by POST /auth/reset-password`
- AuthZ Boundary: `public`
- Metrics/Isolation: reset token 按 `userId` 管理；与 `classroomTaskId` 无关
- Consistency/Constraints: `forgot-password` 固定返回通用成功提示，避免邮箱枚举；仅对 `status=active` 用户创建 token；同一真实用户邮箱按 `userId + createdAt` 做 60 秒冷却，命中冷却时不创建新 token、不失效旧 token、不发新邮件；未命中冷却时才失效同用户旧的未用 token；明文 token 只出现在邮件链接中，数据库只保存 `tokenHash`；重置成功后更新 `passwordHash`、标记 `usedAt`、并清理该用户全部 sessions
- Deps/Side Effects: `UserModel`, `PasswordResetTokenModel`, `MailService`, `SessionService`, 共享密码 helper；写 token、发邮件、更新密码、删除 sessions
- Performance Notes: 通过 `tokenHash` 精确查找；TTL 索引负责后台清理，业务层仍显式检查 `expiresAt/usedAt`
- SoT: `backend/src/modules/auth/services/password-reset.service.ts`; `backend/src/modules/auth/schemas/password-reset-token.schema.ts`
- Failure Modes:
  - 邮箱不存在或用户不可登录 -> 返回通用成功提示，不发邮件、不建 token
  - token 无效/过期/已使用 -> `400 Reset token is invalid`
  - 邮件发送失败 -> 记录错误并使本次新 token 失效，接口仍返回通用成功提示

## Service Card 02

- Service: `backend/src/modules/users/services/users.service.ts`
- Domain: `User`
- Actions: `get-me`, `update-me`, `change-password`
- I/O Shape:
  - In: `userId`, `UpdateProfileDto`, `ChangePasswordDto`, `currentSessionToken`
  - Out: `user public profile` | `{ ok: true }`
- Key Methods:
  - `getMe(userId: string): Promise<Record<string, unknown>> — called by /users/me endpoint`
  - `updateMe(userId: string, dto: UpdateProfileDto): Promise<Record<string, unknown>> — called by PATCH /users/me`
  - `changePassword(userId: string, dto: ChangePasswordDto, currentSessionToken?: string): Promise<{ ok: true }> — called by POST /users/me/change-password`
- AuthZ Boundary: `login-only`
- Metrics/Isolation: 无 `classroomTaskId` 口径
- Consistency/Constraints: `PATCH /users/me` 仅允许更新 `name/studentNo/employeeNo`；`POST /users/me/change-password` 必须校验当前密码、新密码 trim 后非空、长度下限、且不得与当前密码相同；改密成功后保留当前会话并失效其它历史会话；`GET/PATCH` 返回口径一致且不含 `passwordHash`
- Deps/Side Effects: `UserModel`, `SessionService`, 共享密码 helper；读写公开资料字段、更新密码哈希、删除历史 sessions
- Performance Notes: `lean + select` 最小字段读取；`undefined` 字段忽略更新（不写入）；session 清理复用 `SessionService.clearUserSessions`
- SoT: `backend/src/modules/users/services/users.service.ts`; `backend/src/modules/users/schemas/user.schema.ts`; `backend/src/modules/auth/schemas/session.schema.ts`
- Failure Modes:
  - 用户不存在 -> `404 User not found`
  - 当前密码错误 -> `401 Current password is incorrect`
  - 新密码不合法（空白/长度不足/与当前相同） -> `400`

## Service Card 03

- Service: `backend/src/modules/courses/services/courses.service.ts`
- Domain: `Course`
- Actions: `create`, `update(status)`, `list/get`, `archive`, `delete-empty-course`
- I/O Shape:
  - In: `Create/Update/QueryCourseDto`, `courseId`, `userId`
  - Out: `CourseResponseDto` | `{ items, total, page, limit }`
- Key Methods:
  - `createCourse(dto: CreateCourseDto, userId: string): Promise<CourseResponseDto> — called by POST /courses`
  - `updateCourse(id: string, dto: UpdateCourseDto, userId: string): Promise<CourseResponseDto> — called by PATCH /courses/:id`
  - `listCourses(query: QueryCourseDto, userId: string): Promise<{ items: CourseResponseDto[]; total: number; page: number; limit: number }> — called by GET /courses`
  - `getCourse(id: string, userId: string): Promise<CourseResponseDto> — called by GET /courses/:id`
  - `archiveCourse(id: string, userId: string): Promise<CourseResponseDto> — called by POST /courses/:id/archive`
  - `deleteCourse(id: string, userId: string): Promise<{ ok: true }> — called by DELETE /courses/:id`
- AuthZ Boundary: `teacher-only`（service 内 `ensureTeacher` 强校验）
- Metrics/Isolation: 按 `createdBy(userId)` 做课程隔离
- Consistency/Constraints: `unique(createdBy,code)`；`PATCH /courses/:id` 支持 `status=ACTIVE|ARCHIVED` 归档/恢复；归档课程禁止更新 `code/name/term/courseLabel`，但允许通过 `status=ACTIVE` 恢复；删除仅允许空课程（`Classroom.exists({ courseId })===false`）；非空删除返回 `409(code=COURSE_NOT_EMPTY)`；分页上限 `100`；`courseLabel` 为可选单值分类字段（与 `Task.courseLabel` 共用 `TASK_COURSE_LABELS`），创建/更新时会 trim 并拒绝白名单外值，空白输入按未设置处理
- Deps/Side Effects: `CourseModel`, `ClassroomModel`, `UserModel`；写课程文档
- Performance Notes: `find + countDocuments` 并发执行，避免串行等待
- SoT: `backend/src/modules/courses/schemas/course.schema.ts`; `backend/src/modules/courses/dto/query-course.dto.ts`
- Failure Modes:
  - 非教师 -> `403 Not allowed to manage courses`
  - 课程不存在 -> `404`
  - 非空课程删除 -> `409 Conflict`（`code=COURSE_NOT_EMPTY`，message=`该课程下已有班级记录，不能删除，只能归档`）
  - 重复 code(`11000`) -> `400 Course code already exists`

## Service Card 04

- Service: `backend/src/modules/classrooms/services/classrooms.service.ts`
- Domain: `Classroom`
- Actions: `create/update/list/get`, `join/remove`, `list-students`, `archive/restore`, `delete-empty-classroom`, `dashboard-delegate`
- I/O Shape:
  - In: `classroomId`, `JoinClassroomDto(joinCode)`, `QueryClassroomDto`, `QueryClassroomStudentsDto`, `userId`
  - Out: `ClassroomResponseDto` | `{ items, total, page, limit }` | `dashboard aggregate` | `classroom students paged list`
- Key Methods:
  - `createClassroom(dto: CreateClassroomDto, userId: string): Promise<ClassroomResponseDto> — called by POST /classrooms`
  - `updateClassroom(id: string, dto: UpdateClassroomDto, userId: string): Promise<ClassroomResponseDto> — called by PATCH /classrooms/:id (supports status ACTIVE/ARCHIVED)`
  - `deleteClassroom(id: string, userId: string): Promise<{ ok: true }> — called by DELETE /classrooms/:id`
  - `listClassrooms(query: QueryClassroomDto, userId: string): Promise<{ items: ClassroomResponseDto[]; total: number; page: number; limit: number }> — called by GET /classrooms`
  - `listStudents(classroomId: string, query: QueryClassroomStudentsDto, userId: string): Promise<{ items: unknown[]; total: number; page: number; limit: number }> — called by GET /classrooms/:id/students`
  - `joinClassroom(dto: JoinClassroomDto, userId: string): Promise<ClassroomResponseDto> — called by POST /classrooms/join`
  - `removeStudent(id: string, studentId: string, userId: string): Promise<ClassroomResponseDto> — called by POST /classrooms/:id/students/:uid/remove`
  - `getDashboard(id: string, userId: string, includeClosedTasks?: boolean): Promise<Record<string, unknown>> — delegates to teacher dashboard service`
  - `getMyLearningDashboard(query: QueryClassroomDto, userId: string, includeHistorical?: boolean): Promise<Record<string, unknown>> — delegates to student dashboard service`
- AuthZ Boundary: `teacher-only`（管理） / `student-only`（加入） / `member-or-owner`（查看）
- Metrics/Isolation: 班级管理按 `teacherId`；成员判定与统计统一通过 `EnrollmentService`；下游统计统一是 `classroomTaskId` 口径
- Consistency/Constraints: joinCode 生成重试上限 `8`；`ClassroomResponse` 保留 `courseId` 并补充只读 `course` 摘要（`id/code/name/term/courseLabel/status`），列表批量查询课程避免 N+1，课程记录缺失时 `course` 可为空且不影响班级读取；`PATCH /classrooms/:id` 支持 `status` 归档/恢复；归档状态下禁止改名但允许通过 `status=ACTIVE` 恢复；删除仅允许空班级（主判定：`ClassroomTask.exists({ classroomId })===false` 且 `Enrollment.exists({ classroomId })===false`，其中 Enrollment 判定包含 `REMOVED` 历史记录）；`studentIds` 仅作防御性辅助校验，不作为唯一主判定来源；非空删除返回 `409(code=CLASSROOM_NOT_EMPTY)`；`join/remove` 先写 Enrollment(`ACTIVE/REMOVED`)，`studentIds` 仅作为 legacy 镜像输出，不参与授权/统计；`GET /classrooms/:id/students` 只认 Enrollment（`role=STUDENT`），默认返回 ACTIVE，`includeRemoved=1/true` 时返回 ACTIVE+REMOVED，默认排序 `joinedAt desc, _id desc`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `EnrollmentModel`, `CourseModel`, `UserModel`, `EnrollmentService`, `TeacherClassroomDashboardService`, `TeacherClassroomWeeklyReportService`, `StudentLearningDashboardService`, `ProcessAssessmentService`, `ClassroomExportSnapshotService`
- Performance Notes: 列表查询分页 + 索引过滤；join/remove 采用 Enrollment upsert/update，并可选镜像更新 `studentIds`；`listStudents` 按页批量拉取用户公开字段避免 N+1
- SoT: `backend/src/modules/classrooms/services/classrooms.service.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`; `backend/src/modules/classrooms/enrollments/schemas/enrollment.schema.ts`
- Failure Modes:
  - 非授权角色 -> `403`
  - 班级/课程不存在 -> `404`
  - 非空班级删除 -> `409 Conflict`（`code=CLASSROOM_NOT_EMPTY`，message=`该班级已有成员或任务记录，不能删除，只能归档`）
  - joinCode 冲突或分配失败 -> `400 Unable to allocate join code`

## Service Card 05

- Service: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`
- Domain: `ClassroomTask + Submission + Feedback + AiFeedbackJob`
- Actions: `aggregate-classroom-tasks`, `aggregate-submissions`, `aggregate-ai-status`, `build-dashboard`
- I/O Shape:
  - In: `classroomId`, `teacherUserId`, `includeClosedTasks?`
  - Out: `teacher dashboard aggregate`
- Key Methods:
  - `getDashboard(id: string, userId: string, includeClosedTasks?: boolean): Promise<Record<string, unknown>> — called by ClassroomsService.getDashboard and /classrooms/:id/dashboard`
- AuthZ Boundary: `teacher-only + owner-only`（先校验班级 teacherId）
- Metrics/Isolation: 强制按 `classroomTaskId` 聚合；课堂任务可见性使用 `classroomTask.status` 白名单；默认只返回 `ACTIVE`，`includeClosedTasks=true` 返回 `ACTIVE+CLOSED`，`RECALLED/缺失/未知状态` 不返回；`studentsCount` 来源为 Enrollment count；`notRequested = submissionsCount - requestedCount`（下限 0）
- Consistency/Constraints: 每个 task item 返回 `classroomTaskStatus`（来自 `ClassroomTask.status`，不可用 `task.status/classroom.status/dueAt` 替代）、`taskTemplateStatus`（关联模板当前状态，`DRAFT|PUBLISHED|ARCHIVED|null`）与 `taskPublisher:{id,name?}|null`（关联模板 `Task.createdBy` 用户摘要）；教师看板不按模板状态过滤课堂任务实例，非 `PUBLISHED` 模板的既有实例仍返回历史进展；默认统计与 tasks 均排除 `CLOSED`，显式包含关闭任务时 summary/任务级统计与返回任务集合一致；教师默认教学统计统一只面向当前 Enrollment `ACTIVE` 学生：`studentsCount`、`distinctStudentsSubmitted/submissionsCount/lateSubmissionsCount/lateDistinctStudentsCount/lateStudentsTotal`、AI feedback 统计与 `topTags` 均只计入 ACTIVE 学生对应 submissions；已移除学生历史 submissions/AI jobs/feedback 仍保留，但默认不进入看板统计；顶层 `archiveSuggestion` 只对 `Classroom.status=ACTIVE` 班级给建议，规则为“无当前活跃任务 + 最近 30 天无学生提交 + 非新班级保护”；当前活跃任务定义为 `ClassroomTask.status=ACTIVE`、模板 `Task.status=PUBLISHED` 且 `dueAt` 未超过 30 天缓冲，或无 `dueAt` 且 `publishedAt` 在 90 天内；新班级保护为 30 天；`archiveSuggestion` 不受 `includeClosedTasks` 影响，不产生写操作；仅统计 `FeedbackSource.AI` 的 tags；top tags 限制 `5`；迟交维度包含 `lateSubmissionsCount/lateDistinctStudentsCount`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `FeedbackModel`, `AiFeedbackJobModel`, `UserModel`, `EnrollmentService`；只读聚合
- Performance Notes: ClassroomTask 聚合阶段前置状态白名单过滤，并在组装前做防御过滤；后续 submissions/AI/tags 聚合只围绕可见 `classroomTaskIds` 展开；模板发布者按 `Task.createdBy` 批量查 User 并用 Map 合并；多个 `aggregate` 并行 + Map 合并，避免逐 task N+1
- SoT: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Failure Modes:
  - 非班级教师或班级不存在 -> `404 Classroom not found`
  - 班级无发布任务 -> 返回空 tasks 结构（非异常）
  - 聚合结果缺项 -> 用 `0` 补齐计数，防止负值/空引用

## Service Card 06

- Service: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`
- Domain: `ClassroomTask + Submission + Feedback + AiFeedbackStatus`
- Actions: `list-my-classrooms`, `aggregate-classroom-tasks`, `pick-latest-submission`, `map-status`, `derive-completion-status`
- I/O Shape:
  - In: `QueryClassroomDto(page,limit,status)`, `userId`, `includeHistorical?`
  - Out: `student dashboard aggregate`
- Key Methods:
  - `getMyLearningDashboard(query: QueryClassroomDto, userId: string, includeHistorical?: boolean): Promise<Record<string, unknown>> — called by ClassroomsService and /classrooms/mine/dashboard`
- AuthZ Boundary: `student-only`（由上层 `ClassroomsService.ensureStudent` 保障）
- Metrics/Isolation: “我的班级”主路径来自 `EnrollmentService.listActiveClassroomIdsByUser`；学生看板是当前学习工作台，仅返回 `classroom.status=ACTIVE` 且 `classroomTask.status=ACTIVE` 的任务；模板当前 `task.status` 不再参与学生端运行态过滤，`ARCHIVED/DRAFT` 不影响既有 classroomTask 可见性；默认隐藏长期历史任务，`includeHistorical=true` 时才回看当前 ACTIVE 班级下的历史任务；提交与状态按最终返回的 `classroomTaskId` 聚合；教师摘要位于 `classroom.teacher`，只暴露 `id/name/employeeNo`；课程摘要位于 `classroom.course`，只暴露 `id/name/term/code`；`completionStatus` 只基于当前 task 的 `myLatestSubmission.submissionId` 查询反馈，不按 `taskId/classroomTaskId/studentId` 粗暴聚合反馈
- Consistency/Constraints: 默认可见时间窗口：有 `dueAt` 时 `dueAt >= now` 返回 `CURRENT`，`now-30天 <= dueAt < now` 返回 `RECENTLY_EXPIRED` 且仍展示，`dueAt < now-30天` 为 `HISTORICAL` 且默认隐藏；无 `dueAt` 时 `publishedAt >= now-90天` 返回 `CURRENT`，更早或缺失时间为 `HISTORICAL`；`includeHistorical=true` 返回 `CURRENT|RECENTLY_EXPIRED|HISTORICAL`，但仍不返回归档班级或非 ACTIVE classroomTask；每个返回班级项的 `classroom` 现稳定补 `teacher:{id,name,employeeNo}` 与 `course:{id,name,term,code}`；教师记录缺失或空白字段时回落 `name=null, employeeNo=null`；课程记录缺失或空白字段时回落 `name=null, term=null, code=null`；课程摘要不返回 `courseLabel/createdBy/status/createdAt/updatedAt`；每个 task item 返回 `studentVisibilityStatus` 与 `isHistorical`；无 job 记录时状态回退 `NOT_REQUESTED`；每个返回 task item 顶层返回 `completionStatus`，值域为 `NOT_SUBMITTED|NO_FEEDBACK|QUALIFIED|QUALIFIED_WITH_WARNINGS|UNQUALIFIED`；反馈来源只纳入 `TEACHER/AI`，`SYSTEM` 不参与；最终来源优先级 `TEACHER > AI`；同一来源多条反馈取最严重 `ERROR > WARN > INFO`；`INFO->QUALIFIED`、`WARN->QUALIFIED_WITH_WARNINGS`、`ERROR->UNQUALIFIED`；无提交返回 `NOT_SUBMITTED`，有最新提交但无 TEACHER/AI 反馈返回 `NO_FEEDBACK`；过滤后无可见任务的班级不返回空分组，`total` 按最终返回班级分组统计
- Deps/Side Effects: `ClassroomModel`, `CourseModel`, `ClassroomTaskModel`, `SubmissionModel`, `FeedbackModel`, `UserModel`, `AiFeedbackJobService`, `EnrollmentService`；只读
- Performance Notes: 先按 enrolled classroomIds 读取 ACTIVE 班级与 ACTIVE classroomTask，再按 30/90 天窗口和 `includeHistorical` 得出最终可见任务集合后分页班级分组；当前页班级涉及的课程用 `CourseModel` 按 `courseId` 批量查询并组装 `classroom.course`，教师用 `UserModel` 按 `teacherId` 批量查询并组装 `classroom.teacher`，避免按班级循环查关联记录；后续 submissions/statusMap/completionStatus 只围绕最终返回的 classroomTaskIds 批量计算，避免 CLOSED/归档班级/默认隐藏历史任务额外查询与历史提交混入
- SoT: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Failure Modes:
  - 学生未加入任何班级 -> 返回空 `items`
  - 某任务无提交 -> `myLatestSubmission=null`
  - 某任务无提交 -> `completionStatus.status=NOT_SUBMITTED`
  - 某任务最新提交无 TEACHER/AI 反馈 -> `completionStatus.status=NO_FEEDBACK`
  - 某提交无 job -> `aiFeedbackStatus=NOT_REQUESTED`

## Service Card 07

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`
- Domain: `ClassroomTask + Submission + Z3/Z4 聚合`
- Actions: `publish-to-classroom`, `query-publishable-templates`, `list/get-classroom-task`, `submit-classroom-task`, `list-task-submissions`, `aggregate-feature-views`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `CreateClassroomTaskDto`, `UpdateClassroomTaskDto`, `QueryClassroomTaskDto`, `QueryClassroomTaskSubmissionsDto`, `CreateSubmissionDto`, `userId`
  - Out: `ClassroomTaskResponseDto` | `{ items, total, page, limit }` | `SubmissionResponseDto` | `classroomTask submissions paged list`
- Key Methods:
  - `createClassroomTask(classroomId: string, dto: CreateClassroomTaskDto, userId: string): Promise<ClassroomTaskResponseDto> — called by POST /classrooms/:id/tasks`
  - `updateClassroomTask(classroomId: string, classroomTaskId: string, dto: UpdateClassroomTaskDto, teacherId: string): Promise<ClassroomTaskResponseDto> — called by PATCH /classrooms/:classroomId/tasks/:classroomTaskId`
  - `updateClassroomTaskStatus(classroomId: string, classroomTaskId: string, dto: UpdateClassroomTaskStatusDto, teacherId: string): Promise<ClassroomTaskResponseDto> — called by PATCH /classrooms/:classroomId/tasks/:classroomTaskId/status`
  - `listPublishableTaskTemplates(classroomId: string, query: QueryPublishableTaskTemplateDto, teacherId: string): Promise<{ items: PublishableTaskTemplateItemResponseDto[]; total: number; page: number; limit: number }> — called by GET /classrooms/:id/publishable-task-templates`
  - `listClassroomTasks(classroomId: string, query: QueryClassroomTaskDto, userId: string): Promise<{ items: ClassroomTaskResponseDto[]; total: number; page: number; limit: number }> — called by GET /classrooms/:id/tasks`
  - `getClassroomTask(classroomId: string, classroomTaskId: string, userId: string): Promise<ClassroomTaskResponseDto> — called by GET /classrooms/:id/tasks/:classroomTaskId`
  - `createClassroomTaskSubmission(classroomId: string, classroomTaskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by classroom-task submission endpoint`
  - `listClassroomTaskSubmissions(classroomId: string, classroomTaskId: string, query: QueryClassroomTaskSubmissionsDto, teacherId: string): Promise<{ items: unknown[]; total: number; page: number; limit: number }> — called by GET /classrooms/:classroomId/tasks/:classroomTaskId/submissions`
  - `getMyTaskDetail(...): Promise<Record<string, unknown>> — called by /classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`
  - `getLearningTrajectory(...): Promise<Record<string, unknown>> — called by /classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`
- AuthZ Boundary: `teacher-only`（发布） / `student-only + member-only`（提交） / `member-or-owner`（查看）
- Metrics/Isolation: 学生提交通过 `createSubmissionForClassroomTask(..., classroomTaskId)` 绑定隔离主键；Z3/Z4 聚合严格按 `classroomTaskId`；提交列表读取同样只按 `classroomTaskId`，不按 `taskId` 跨班聚合；学生集合基于 Enrollment ACTIVE
- Consistency/Constraints: 新发布 classroomTask 时要求 Task 已 `PUBLISHED`；班级 `ARCHIVED` 禁止发布；`unique(classroomId,taskId)` 防重复发布；`ClassroomTaskResponseDto` 列表/详情补充 `taskPublisher:{id,name?}|null`，来源为关联模板 `Task.createdBy` 用户摘要且只含 `id/name`；`ClassroomTask` 生命周期状态为 `ACTIVE/CLOSED/RECALLED`（默认 `ACTIVE`，旧数据缺省按 `ACTIVE` 兼容读取）；实例级配置更新接口（`PATCH /classrooms/:classroomId/tasks/:classroomTaskId`）仅允许修改 `dueAt/settings.allowLate/settings.maxAttempts`，并与状态流接口分离；配置更新状态边界为 `ACTIVE/CLOSED` 可编辑、`RECALLED` 不可编辑；状态流允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`（恢复提交），其中撤回前必须“无提交”，`RECALLED` 保持封闭不可恢复，且 `CLOSED -> RECALLED` 不允许；`CLOSED -> ACTIVE` 仅恢复状态，不自动修改 `dueAt/settings.allowLate/settings.maxAttempts`；本阶段不支持撤回后重发同模板；发布候选模板查询固定内置“当前教师可见性 + `status=PUBLISHED` + 排除本班已发布 taskId”，并支持 `courseLabel/onlyMine/knowledgeModule/stage/page/limit`；每个发布候选 item 现返回 `publisher:{id,name?}|null`，来源为 `Task.createdBy` 用户摘要且只含 `id/name`；当请求未显式传 `courseLabel` 且班级课程有 `courseLabel` 时优先排序课程分类匹配模板；**学生提交门禁分层：`ClassroomTasksService` 负责 `student + Enrollment ACTIVE + classroom 归属 + classroom.status=ACTIVE + classroomTask.status=ACTIVE` 校验；`LearningTasksService.createSubmissionInternal` 在真正创建 submission/自动 AI job 前二次 enforce `classroom.status=ACTIVE`、`classroomTask.status=ACTIVE`，并继续 enforce `dueAt/allowLate`（超时且 `allowLate=false` -> `403(code=LATE_SUBMISSION_NOT_ALLOWED)`），模板当前状态不再参与既有 classroomTask 的学生运行态。**；提交列表 `aiFeedbackStatus` 无 job 显式回填 `NOT_REQUESTED`；提交列表 `items[*].feedbackCount` 为 Feedback 总条数（按当前页 submissionIds 聚合，缺失回填 `0`）；learning-trajectory `items[*]` 返回结构化 `student:{id,name,studentNo,email}`（兼容 `studentName`）；不返回 `passwordHash/content.codeText`
- MyTaskDetail Participation: `getMyTaskDetail` 顶层返回 `participationStatus`，仅表达 `classroom.status/classroomTask.status` 导致的只读态；`ACTIVE` 表示状态层可参与，`CLASSROOM_NOT_ACTIVE`、`CLASSROOM_TASK_NOT_ACTIVE` 返回 `readOnly=true/canSubmit=false/canRequestAiFeedback=false`；模板当前状态仍可在 `task.status` 字段中读到，但不再参与学生运行态只读判断；该字段不计算 `dueAt/allowLate/cooldown/NOT_REQUESTED`，动作接口仍是最终校验。
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `TaskModel`, `SubmissionModel`, `FeedbackModel`, `UserModel`, `EnrollmentService`, `AiFeedbackJobService`, `LearningTasksService`
- Performance Notes: 任务列表使用 `aggregate(basePipeline + totalPipeline)` 生成分页数据与总数，并按关联模板 `createdBy` 批量查询发布者摘要；发布候选模板列表同样按当前页 `createdBy` 去重后批量查 User 并回填 `publisher`，避免 N+1；提交列表按页查询 submission 后批量查询用户公开信息、AI 状态与 feedbackCount（Feedback 按 submissionIds group）避免 N+1
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`; `backend/src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Failure Modes:
  - 班级/任务/课堂任务不存在 -> `404`
  - 无权限访问或提交 -> `403`
  - 重复发布(`11000`) -> `400 Task already published to classroom`

## Service Card 08

- Service: `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`
- Domain: `Task|Submission|Feedback|AiFeedbackJob`
- Actions: `manage-task-template`, `filter-task-template`, `submit`, `read-submission-detail`, `request-ai-feedback`, `feedback-create/update/list`, `stats`
- I/O Shape:
  - In: `taskId/submissionId/classroomTaskId`, `Create/Update DTO(含可选 courseLabel/visibility)`, `RequestAiFeedbackDto`, `filters/page/limit(含可选 courseLabel/scope)`, `user/userId`
  - Out: `TaskResponseDto` | `SubmissionResponseDto(含 submittedAt/isLate/lateBySeconds)` | `SubmissionDetailResponseDto` | `FeedbackResponseDto` | `list/paged list/aggregate`
- Key Methods:
  - `createTask(dto: CreateTaskDto, userId: string): Promise<TaskResponseDto> — called by POST /learning-tasks/tasks`
  - `updateTask(id: string, dto: UpdateTaskDto, userId: string): Promise<TaskResponseDto> — called by PATCH /learning-tasks/tasks/:id`
  - `publishTask(id: string, userId: string): Promise<TaskResponseDto> — called by POST /learning-tasks/tasks/:id/publish`
  - `archiveTask(id: string, userId: string): Promise<TaskResponseDto> — called by POST /learning-tasks/tasks/:id/archive`
  - `listTasks(query: QueryTaskDto, userId: string): Promise<{ items: TaskResponseDto[]; total: number; page: number; limit: number }> — called by GET /learning-tasks/tasks`
  - `getTask(id: string, userId: string): Promise<TaskResponseDto> — called by GET /learning-tasks/tasks/:id`
  - `restoreTask(id: string, userId: string): Promise<TaskResponseDto> — called by POST /learning-tasks/tasks/:id/restore`
  - `createSubmission(taskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by generic task submission endpoint`
  - `createSubmissionForClassroomTask(taskId: string, classroomTaskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by ClassroomTasksService for isolated submissions`
  - `getSubmissionDetail(submissionId: string, user: { id: string; roles?: string[] }): Promise<SubmissionDetailResponseDto> — called by GET /learning-tasks/submissions/:id`
  - `requestAiFeedback(submissionId: string, user: { id: string; roles?: string[] }, dto: RequestAiFeedbackDto): Promise<{ submissionId: string; jobId: string; status: AiFeedbackJobStatus; aiFeedbackStatus: AiFeedbackStatus }> — called by POST /learning-tasks/submissions/:submissionId/ai-feedback/request`
  - `updateFeedback(submissionId: string, feedbackId: string, dto: UpdateFeedbackDto, userId: string): Promise<FeedbackResponseDto> — called by PATCH /learning-tasks/submissions/:submissionId/feedback/:feedbackId`
  - `listTaskSubmissions(taskId: string, userId: string, page?: number, limit?: number): Promise<{ items: SubmissionResponseDto[]; total: number; page: number; limit: number }> — called by teacher submissions endpoint`
  - `getStats(taskId: string, userId: string): Promise<Record<string, unknown>> — called by /learning-tasks/tasks/:id/stats`
- AuthZ Boundary: `teacher-owner`（更新/查看任务提交/反馈写入/统计/手工 request） + `student`（提交/查自己提交/对本人 submission 手工 request）；模板详情读取遵循可见性：作者可读、他人仅可读 `SHARED`（含旧数据缺省兼容视为 `SHARED`）；`getSubmissionDetail` 允许学生本人读取；当 `submission.classroomTaskId` 存在时仅该 `classroomTask` 所属班级 owner teacher 可读；当 `submission.classroomTaskId` 为空时仅 `task.createdBy` 对应 task owner teacher 可读；其他用户禁止访问
- Consistency/Constraints: 学生对本人课堂任务 submission 手工 `requestAiFeedback` 时，创建/确保 AI job 前必须校验 `classroom.status=ACTIVE`、`classroomTask.status=ACTIVE`；模板当前 `task.status` 不再阻断已发布 classroomTask 的学生 AI 请求。教师手工 request 保持原资源管理权限口径。
- Metrics/Isolation: `Submission.classroomTaskId` 可选；`aiFeedbackStatus` 通过 `AiFeedbackJobService` 推导；top tags 由 feedback 聚合
- Consistency/Constraints: `Task.courseLabel` 为可选单值分类字段（非 `Course` 外键、非绑定约束、仅模板治理用途）；`create/update/list/get` 已支持 `courseLabel`，且任务模板列表/详情返回 `publisher:{id,name?}|null`（`Task.createdBy` 用户摘要，只含 `id/name`）；空白输入会 trim 并按未设置处理；`listTasks` 支持按 `courseLabel` 过滤，且 `courseLabel=未分类` 时兼容匹配字段缺省任务；`courseLabel` 不参与发布到班级的课程一致性校验。`listTasks` 已将 `status/knowledgeModule/stage` 纳入数据库级过滤（与 `scope/courseLabel` 叠加），为任务模板页后续真实分页与真实筛选做后端契约准备。`Task.visibility` 新增可见性维度（`PRIVATE|SHARED`，新建默认 `PRIVATE`）；旧数据缺省 `visibility` 按 `SHARED` 兼容；`scope`（`mine|shared|all`，默认 `mine`）决定模板列表视图范围：`mine=我的全部模板`、`shared=共享池(包含我自己设为 SHARED 的模板)`、`all=我的全部+共享池`；`createdBy` query 仅保留兼容，不再作为越权筛选入口。共享只影响读可见性，不改变作者编辑/发布权限。任务模板生命周期已收口为单向 `DRAFT -> PUBLISHED -> ARCHIVED`：创建仅允许初始 `DRAFT/PUBLISHED`（缺省 `DRAFT`，禁止 `ARCHIVED`）；状态变更必须走动作接口，不再走普通 `PATCH`。`updateTask` 如果收到与当前状态不同的 `dto.status`，固定返回 `400 Task template status must be changed through lifecycle actions`；如果 `dto.status` 与当前状态相同，则忽略该字段继续编辑其它内容；`ARCHIVED` 模板普通 `PATCH` 更新仍禁止。`publishTask` 只允许 `DRAFT -> PUBLISHED`，当前已是 `PUBLISHED` 保持幂等返回，`ARCHIVED -> PUBLISHED` 返回 `400 Archived task templates cannot be published`。`archiveTask` 只允许 `PUBLISHED -> ARCHIVED`，`DRAFT/ARCHIVED` 返回 `400 Only published task templates can be archived`，且不检查 ClassroomTask 引用，因为归档不影响既有 classroomTask 运行。`restoreTask` 保留兼容入口但稳定返回 `400 Archived task templates cannot be restored to draft; clone as draft instead`；后续若需复用归档模板，应通过“复制为新草稿”新能力实现。ClassroomTask 承担教学运行态，Task 只承担模板库资产管理。attemptNo 采用“查询最新 + 最多 3 次重试”；仅 `PUBLISHED` 通用任务可提交；课堂任务提交流程会计算并持久化 `submittedAt/isLate/lateBySeconds`，且不再要求模板当前 `status=PUBLISHED`；`dueAt` 存在且 `allowLate=false` 且超时 -> `403 + code=LATE_SUBMISSION_NOT_ALLOWED`；自动入队采用 attempt-based 策略：默认 `attemptNo==1` 自动入队、`attemptNo>1` 返回 `NOT_REQUESTED`；策略受 `AI_FEEDBACK_AUTO_ON_SUBMIT`（默认 true）与 `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`（默认 true）控制；`request-ai-feedback` 为产品能力，幂等确保 job（存在返回既有，不存在创建 `PENDING`）；`getSubmissionDetail` 是 submission detail 稳定读源，允许返回 `content.codeText`，但课堂提交流水列表 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 仍不返回 `content.codeText`；教师默认提交列表只返回当前 Enrollment `ACTIVE` 学生的 submissions，`items/total` 过滤口径一致；已移除学生历史 submissions 保留在数据库中，但默认不进入该列表；教师反馈更新仅允许 `source=TEACHER`，`AI/SYSTEM` 只读，且权限复用 submission detail 教师管理口径（有 `classroomTaskId` 时按课堂任务所属班级 owner teacher，缺省时按 task owner）；`Feedback.createdBy` 为 optional，旧教师反馈缺失时允许具备管理权限的教师更新并补写，不迁移历史数据
- Deps/Side Effects: `ConfigService`, `TaskModel`, `SubmissionModel`, `FeedbackModel`, `ClassroomTaskModel`, `ClassroomModel`, `UserModel`, `AiFeedbackJobService`；提交后按 env 策略决定是否 `enqueue`，手工 request 走 `ensureJobForSubmission` 幂等创建
- Performance Notes: 批量查询 + `Promise.all`；模板列表按 `createdBy` 批量查询发布者摘要；状态映射批量取 jobs，避免逐提交查询；`Task` schema 已补发布候选查询复合索引：`(createdBy,status,courseLabel,knowledgeModule,stage,updatedAt,createdAt)` 覆盖 `onlyMine` 分支，`(visibility,status,courseLabel,knowledgeModule,stage,updatedAt,createdAt)` 覆盖共享可见分支。
- SoT: `backend/src/modules/learning-tasks/schemas/submission.schema.ts`; `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`; `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`; `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts`
- Failure Modes:
  - 任务不存在 -> `404`
  - submission 不存在（含 submission detail） -> `404`
  - 非任务创建者访问教师视图 -> `403`
  - 学生访问非本人 submission detail -> `403`
  - teacher 非 classroom owner / task owner 访问 submission detail -> `403`
  - 任务未发布 -> `400 Task is not published`
  - attemptNo 分配冲突连续失败 -> `400 Unable to allocate attempt number`

## Service Card 08A

- Service: `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Domain: `Enrollment`
- Actions: `enroll`, `remove`, `list-active`, `count/group-count`
- I/O Shape:
  - In: `classroomId`, `userId`, `page/limit`, `classroomIds[]`
  - Out: `void` | `studentId[]` | `classroomId[]` | `count | grouped-count-map` | `boolean`
- Key Methods:
  - `enrollStudent(classroomId: string, userId: string): Promise<void>`
  - `removeStudent(classroomId: string, userId: string): Promise<void>`
  - `listActiveStudentIds(...)`, `listActiveStudentIdsByClassroomPage(...)`, `listActiveStudentsByClassroomPage(...)`
  - `countStudents(classroomId: string)`, `countStudentsGroupedByClassroomIds(classroomIds: ObjectId[])`
  - `listActiveClassroomIdsByUser(userId: string)`, `isStudentActiveInClassroom(...)`
- AuthZ Boundary: `internal-only`（由调用方 service/controller 做 teacher/student/member 约束）
- Metrics/Isolation: 成员 SoT 仅为 Enrollment（`role=STUDENT,status=ACTIVE`）；所有成员数、成员列表、学生-班级关系从此处读取
- Consistency/Constraints: `enrollStudent` 幂等 upsert（并发重复键收敛为 ACTIVE）；`removeStudent` 软删除为 `REMOVED` 并写 `removedAt`
- Deps/Side Effects: `EnrollmentModel`；写入 enrollment 集合，不依赖 `classroom.studentIds`
- Performance Notes: 提供分页成员读取（含 `joinedAt`）与 grouped count，避免上层 N+1 计数
- SoT: `backend/src/modules/classrooms/enrollments/schemas/enrollment.schema.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Failure Modes:
  - 非法 ObjectId -> `400`
  - 并发重复写(`11000`) -> 收敛处理（非失败）

## Service Card 08B

- Service: `backend/src/modules/classrooms/services/teacher-classroom-weekly-report.service.ts`
- Domain: `Classroom weekly aggregate (AA)`
- Actions: `resolve-window`, `aggregate-progress`, `aggregate-ai-health`, `build-weekly-report`
- I/O Shape:
  - In: `classroomId`, `window`, `includeRiskStudentIds`, `teacherId`
  - Out: `weekly-report aggregate(progress/atRisk/aiHealth/topTags)`
- Key Methods:
  - `getWeeklyReport(...)`
  - `getWeeklyReportByLowerBound(...)`（供 snapshot 复用）
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: `studentsCount` 与成员全集来自 Enrollment ACTIVE；任务/提交/AI 聚合按 `classroomId + classroomTaskId`；风险口径 `risk = activeStudents - submittedDistinctStudents`
- Consistency/Constraints: 窗口统一用 `createdAt`；默认窗口为 `all`；后端兼容窗口 `all/7d/30d/24h/1h`；`all` 语义为“无时间下界过滤（不拼 lowerBound 条件）”；迟交维度输出 `lateSubmissionsCount/lateStudentsCount`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `EnrollmentService`, `AiFeedbackMetricsAggregator`；只读
- Performance Notes: 以 `classroomTaskIds` 为批次聚合，避免按 task 循环查询
- SoT: `backend/src/modules/classrooms/services/teacher-classroom-weekly-report.service.ts`
- Failure Modes:
  - 班级不存在或非 owner -> `404`
  - 空任务/空成员 -> 返回零值聚合（非异常）

## Service Card 08C

- Service: `backend/src/modules/courses/services/course-overview.service.ts`
- Domain: `Course aggregate (AB)`
- Actions: `authorize-course-owner`, `aggregate-by-classroom`, `merge-ai-metrics`, `sort-page-items`
- I/O Shape:
  - In: `courseId`, `window/sort/order/page/limit`, `teacherId`
  - Out: `{ course, window, generatedAt, page, limit, total, items[] }`
- Key Methods:
  - `getCourseOverview(courseId: string, query: QueryCourseOverviewDto, teacherId: string)`
- AuthZ Boundary: `teacher-only + owner-only`（`course.createdBy === currentUserId`）
- Metrics/Isolation: 仅统计该 teacher 名下 classrooms；`studentsCount` 批量来自 `EnrollmentService.countStudentsGroupedByClassroomIds`；提交/迟交/AI 全按 `classroomTaskId` 关联回 classroom
- Consistency/Constraints: late 指标含 `lateSubmissionsCount/lateStudentsCount`；默认窗口为 `all`；默认 `limit=20` 不变，DTO `limit` 最大上限为 `100`；后端兼容窗口 `all/7d/24h/1h`；`all` 语义为“无时间下界过滤（classroomTasks/submissions/jobs 不拼 `createdAt >= lowerBound`）”；禁止跨班 taskId 兜底聚合；`submissionRate` 兼容语义保持 `distinctStudentsSubmitted / studentsCount`；新增 `overallSubmissionCoverage = sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`（分母为 0 返回 0）；`ai.aiSuccessRate` 在 `jobsTotal=0` 时返回 `null`
- Deps/Side Effects: `CourseModel`, `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `EnrollmentService`, `AiFeedbackMetricsAggregator`；只读
- Performance Notes: 先按分页取 classrooms，再做 page-scope 聚合并在页内排序（非全量排序）
- SoT: `backend/src/modules/courses/services/course-overview.service.ts`; `backend/src/modules/classrooms/enrollments/services/enrollment.service.ts`
- Failure Modes:
  - 课程不存在或非 owner -> `404`
  - 空班级页 -> 返回 `items=[]`

## Service Card 08D（Feature: My Task Detail, Z3）

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts#getMyTaskDetail`
- Domain: `ClassroomTask student aggregate`
- Actions: `authorize-student-member`, `load-submissions`, `map-ai-status`, `optional-feedback-preview`, `derive-completion-status`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `userId`, `includeFeedbackItems`, `feedbackLimit`
  - Out: `{ classroom, classroomTask, task, me, submissions[], completionStatus, latest|null }`
- Key Methods:
  - `getMyTaskDetail(classroomId, classroomTaskId, query, userId)`
- AuthZ Boundary: `student-only + Enrollment ACTIVE`
- Metrics/Isolation: 当前课堂任务的所有聚合只按 `classroomTaskId`；`completionStatus` 只基于顶层 `latest.submissionId` 对应的完整 TEACHER/AI 反馈集合，不读取历史 `submissions[]`，不混入其它 `classroomTask`；`aiFeedbackStatus` 无 job 时为 `NOT_REQUESTED`（合法语义）
- Consistency/Constraints: 顶层 `completionStatus.status` 值域为 `NOT_SUBMITTED|NO_FEEDBACK|QUALIFIED|QUALIFIED_WITH_WARNINGS|UNQUALIFIED`；反馈来源只纳入 `TEACHER/AI`，`SYSTEM` 不参与；最终来源优先级 `TEACHER > AI`；同一来源多条反馈取最严重 `ERROR > WARN > INFO`；`INFO->QUALIFIED`、`WARN->QUALIFIED_WITH_WARNINGS`、`ERROR->UNQUALIFIED`；无 latest 返回 `NOT_SUBMITTED`，latest 无 TEACHER/AI 反馈返回 `NO_FEEDBACK`；`includeFeedbackItems=false` 时不拉取返回用 feedback 明细，`feedbackLimit` 只截断返回明细条数，均不影响 `completionStatus` 计算
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `TaskModel`, `SubmissionModel`, `EnrollmentService`, `AiFeedbackJobService`, `FeedbackModel`；只读
- Performance Notes: `statusMap/feedbackSummary/feedbackItemsPreview` 批量并发拉取；`completionStatus` 对 latest submissionId 单独查询完整 TEACHER/AI feedback，避免使用被 `feedbackLimit` 截断的 `latest.feedbackItems`
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`; `backend/src/modules/classrooms/classroom-tasks/dto/query-my-task-detail.dto.ts`
- Failure Modes:
  - 班级/课堂任务/任务不存在 -> `404`
  - 非成员学生 -> `403`
  - 无 latest -> `completionStatus.status=NOT_SUBMITTED`
  - latest 无 TEACHER/AI 反馈 -> `completionStatus.status=NO_FEEDBACK`

## Service Card 08E（Feature: Learning Trajectory, Z4）

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts#getLearningTrajectory`
- Domain: `ClassroomTask teacher aggregate`
- Actions: `page-students`, `aggregate-attempt-trend`, `optional-tag-details`, `sort-page-items`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `teacherId`, `window/page/limit/sort/order/includeAttempts/includeTagDetails`
  - Out: `{ classroomId, classroomTaskId, window, page, limit, total, items[] }`（`items[*]` 至少含 `studentId`、`studentName`、`student:{id,name,studentNo,email}`、attempt/trend）
- Key Methods:
  - `getLearningTrajectory(classroomId, classroomTaskId, query, teacherId)`
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: 学生范围来自 Enrollment ACTIVE（分页在学生维度）；`items` 包含未提交学生（`notSubmitted` 维度可排序）；全链路按 `classroomTaskId` 聚合
- Consistency/Constraints: 默认窗口为 `all`；后端兼容窗口 `all/7d/24h/30d`；`all` 语义为“无时间下界过滤（submissions 不拼 `createdAt >= lowerBound`）”；默认 `limit=20` 不变，`limit` 最大上限已从 `50` 提升到 `100`；排序仍保持“先分页 enrollment，再做 page-local sort”，本阶段不改为全局排序；`includeTagDetails=false` 时跳过 tags 展开聚合；`aiFeedbackStatus` 缺 job 为 `NOT_REQUESTED`；`includeAttempts=true` 时 `attempts[*].feedbackCount` 为 Feedback 全来源总条数（按当前页 submissionIds 聚合，缺失回填 `0`）；`attempts[*].feedbackSummary.totalItems` 继续保留 AI 摘要语义；未提交学生同样携带 `student` 公开信息
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `UserModel`, `EnrollmentService`, `AiFeedbackJobService`, `FeedbackModel`；只读
- Performance Notes: 先分页 enrollment，再用 page-scope studentIds 批量查询 users 与 submissions；对当前页 submissionIds 批量拉取 `statusMap`、AI `feedbackSummary`、全来源 `feedbackCount`，避免 N+1
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`; `backend/src/modules/classrooms/classroom-tasks/dto/query-learning-trajectory.dto.ts`
- Failure Modes:
  - 班级或课堂任务不存在 -> `404`
  - 非班级教师 -> `404`

## Service Card 08F

- Service: `backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts`
- Domain: `ClassroomTask review-pack aggregate (Z5)`
- Actions: `aggregate-overview`, `aggregate-common-issues/examples`, `build-student-tiers`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `teacherId`, `window/topK/examplesPerTag`
  - Out: `{ overview, commonIssues, examples, studentTiers }`（`examples[*]` 为去重样例项，含 `feedbackId/submissionId/attemptNo/severity/type/message/suggestion/source/primaryTag/matchedTags/tags`；`studentTiers.*[*]` 含 `studentId/studentName/studentNo`，`good/watch` 另含 `attemptsCount/latestErrorCount`）
- Key Methods:
  - `getReviewPack(...)`
  - `aggregateCommonIssuesBySubmissionIds(...)` / `aggregateCommonIssuesByClassroomTaskIds(...)`（供 snapshot 复用）
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: 任务相关统计严格按 `classroomTaskId`；成员范围来自 Enrollment ACTIVE
- Consistency/Constraints: 默认窗口为 `all`；后端兼容窗口 `all/7d/24h/30d`；`all` 语义为“无时间下界过滤（submissions/jobs/tags 不拼 lowerBound 条件）”；`topTags` 维持标签展开计数；`examples` 按 `feedbackId` 去重并保留标签归属信息（`primaryTag/matchedTags/tags`）；`studentTiers.good/watch/notSubmitted` 返回完整 ACTIVE 学生分层数组，不再由后端做预览截断，前端负责折叠/展开展示；不返回 `codeText/prompt/apiKey`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `FeedbackModel`, `UserModel`, `EnrollmentService`, `AiFeedbackJobService`, `AiFeedbackMetricsAggregator`；只读
- Performance Notes: examples 候选集仍按 `severityRank DESC + createdAt DESC` 且按 `examplesPerTag` 截断，再做 `feedbackId` 去重输出样例池
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts`; `backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts`
- Failure Modes:
  - 班级或课堂任务不存在 -> `404`
  - 非班级教师 -> `404`

## Service Card 08G

- Service: `backend/src/modules/classrooms/services/process-assessment.service.ts`
- Domain: `Process assessment aggregate (Z6)`
- Actions: `build-student-metrics`, `score-risk`, `sort-page-items`, `export-csv`
- I/O Shape:
  - In: `classroomId`, `window/page/limit/sort/order/excludedTaskIds`, `teacherId`
  - Out: `process-assessment payload` | `csv string`
- Key Methods:
  - `getProcessAssessment(...)`
  - `exportProcessAssessmentCsv(...)`
  - `getProcessAssessmentForSnapshot(...)`（供 snapshot 复用）
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: 成员全集与分页来自 Enrollment ACTIVE；任务范围先按 `classroomId + window` 取 window tasks，再应用 `excludedTaskIds` 得到 `effectiveTaskIds`；提交/迟交/AI/反馈/`topTags` 聚合均基于 `effectiveTaskIds`；迟交指标输出 `lateSubmissionsCount/lateTasksCount`
- Consistency/Constraints: 默认窗口为 `all`；后端兼容窗口 `all/7d/30d/term`；`all` 语义为“无时间下界过滤（tasks/submissions/feedback 不拼 lowerBound）”；`excludedTaskIds` 为 optional query，支持逗号分隔与 repeated query，非法 MongoId 返回 400，合法但不属于当前课堂/窗口的 id 自然无效果；排除全部任务时仍返回当前 ACTIVE 学生且任务相关统计与 score 均为 0；rubric/score/riskLevel 为过程性指标；计分时 `submissionsCount <= 0` 直接返回 `0`，ACTIVE 学生仍保留在列表/CSV 中；CSV 导出与 JSON 复用同一 payload（窗口 + 排除口径一致）并使用手写转义（`"` -> `""`），最终返回字符串前追加 UTF-8 BOM（`\uFEFF`）以兼容 Windows Excel 中文打开；不输出敏感字段
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `AiFeedbackJobModel`, `FeedbackModel`, `EnrollmentService`；只读
- Performance Notes: Enrollment 稳定分页后页内排序（page-local sort）
- SoT: `backend/src/modules/classrooms/services/process-assessment.service.ts`; `backend/src/modules/classrooms/dto/query-process-assessment.dto.ts`
- Failure Modes:
  - 班级不存在或非 owner -> `404`
  - 参数非法 -> `400`

## Service Card 08H

- Service: `backend/src/modules/classrooms/services/classroom-export-snapshot.service.ts`
- Domain: `Classroom snapshot export (Z9)`
- Actions: `compose-snapshot`, `reuse-weekly/review/assessment`, `truncate-by-limit`, `emit-notes`
- I/O Shape:
  - In: `classroomId`, `window`, `limitStudents`, `limitAssessment`, `includePerTask`, `teacherId`
  - Out: `{ meta, course, classroom, students, classroomTasks, summary, statsByClassroomTask, statsByStudent, processAssessment }`
- Key Methods:
  - `getSnapshot(classroomId, query, teacherId)`
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: 复用 weekly/commonIssues/process-assessment 聚合口径；全量按 `classroomId + classroomTaskId`；成员来自 Enrollment ACTIVE
- Consistency/Constraints: 体积保护由 `limitStudents/limitAssessment/includePerTask` 控制，并在 `meta.notes` 标记截断；不输出敏感字段（`codeText/prompt/apiKey`）
- Deps/Side Effects: `ClassroomModel`, `CourseModel`, `ClassroomTaskModel`, `SubmissionModel`, `EnrollmentService`, `TeacherClassroomWeeklyReportService`, `ClassReviewPackService`, `ProcessAssessmentService`, `AiFeedbackMetricsAggregator`；只读
- Performance Notes: 复用聚合服务 + page-scope 截断，避免全量大对象导出
- SoT: `backend/src/modules/classrooms/services/classroom-export-snapshot.service.ts`; `backend/src/modules/classrooms/dto/query-classroom-export-snapshot.dto.ts`; `docs/handoff/handoff-backend-snapshot.md`
- Failure Modes:
  - 班级/课程不存在或非 owner -> `404`
  - 参数非法 -> `400`

## Service Card 09

- Service: `backend/src/modules/learning-tasks/services/learning-tasks-reports.service.ts`
- Domain: `Report(Common Issues)`
- Actions: `authorize-task-owner`, `aggregate-common-issues`, `build-report`
- I/O Shape:
  - In: `taskId`, `userId`, `limit`
  - Out: `report aggregate(summary + topTags + topTypes + examples)`
- Key Methods:
  - `getCommonIssuesReport(taskId: string, userId: string, limit?: number): Promise<Record<string, unknown>> — called by /learning-tasks/tasks/:id/reports/common-issues`
- AuthZ Boundary: `teacher-only + owner-only`
- Metrics/Isolation: 报表按 `taskId` 过滤 submission，再聚合 feedback；统计源限定 `source in [AI,TEACHER]`
- Consistency/Constraints: `limit` 收敛到 `1..10`；examples 每 tag 最多 3 条
- Deps/Side Effects: `TaskModel`, `SubmissionModel`, `FeedbackModel`；只读
- Performance Notes: 单次 aggregate + facet 同时产出 tags/types/examples
- SoT: `backend/src/modules/learning-tasks/services/learning-tasks-reports.service.ts`; `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts`
- Failure Modes:
  - 任务不存在 -> `404`
  - 非任务创建者 -> `403`
  - 无反馈数据 -> 返回空数组而非异常

## Service Card 10

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`
- Domain: `AiFeedbackJob`
- Actions: `enqueue`, `ensure-job`, `list-jobs`, `map-status`
- I/O Shape:
  - In: `submission`, `status`, `limit`, `submissionIds[]`
  - Out: `void` | `{ jobId, status }` | `AiFeedbackJobListItem[]` | `Map<string, AiFeedbackStatus>`
- Key Methods:
  - `enqueue(submission: SubmissionDoc): Promise<void> — used by LearningTasksService when creating submissions`
  - `ensureJobForSubmission(submission: Submission & { _id: Types.ObjectId }): Promise<{ jobId: string; status: AiFeedbackJobStatus }> — used by product request endpoint to idempotently ensure pending job`
  - `listJobs(params: { status?: AiFeedbackJobStatus; limit?: number }): Promise<AiFeedbackJobListItem[]> — called by debug jobs endpoint`
  - `getStatusMapBySubmissionIds(ids: ObjectId[]): Promise<Map<string, AiFeedbackStatus>> — used by dashboards and submission queries`
- AuthZ Boundary: `internal-only`（资源归属校验在 `LearningTasksService.requestAiFeedback`，该 service 仅做 job 幂等/状态映射）
- Metrics/Isolation: 可按 `status` 列表；状态映射支持 dashboard/提交列表批量推导
- Consistency/Constraints: `unique(submissionId)` 去重；默认 `maxAttempts=3`；列表上限 `100`；`ensureJobForSubmission` 遇并发重复键(`11000`)回查返回；无 job 语义为 `NOT_REQUESTED`（由调用方 fallback，不视为异常）
- Deps/Side Effects: `AiFeedbackJobModel`；写 job、记录重复/异常日志
- Performance Notes: `statusMap` 用 `$in` 批量查询，避免逐条查
- SoT: `backend/src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`; `backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum.ts`
- Failure Modes:
  - enqueue 遇重复键(`11000`) -> 忽略并记 debug
  - enqueue 其他写库异常 -> 记 error（不抛到提交主链）
  - 未知 job status -> 映射为 `FAILED` 并记录 warn/debug 日志（避免与“无 job=NOT_REQUESTED”的正常语义混淆）

## Service Card 11

- Service: `backend/src/modules/classrooms/classroom-tasks/services/ai-metrics.service.ts`
- Domain: `ClassroomTask + AiFeedbackJob + Feedback (Aggregate)`
- Actions: `aggregate-jobs`, `aggregate-errors`, `aggregate-feedback`, `build-metrics`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `window(1h|24h|7d)`, `includeTags`
  - Out: `ai-metrics aggregate(summary/errors/feedback)`
- Key Methods:
  - `getAiMetrics(classroomId: string, classroomTaskId: string, window: AiMetricsWindow | undefined, includeTagsQuery: string | undefined, teacherId: string): Promise<Record<string, unknown>> — called by GET /classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`
- AuthZ Boundary: `teacher-only + owner-only`（先校验 classroom.teacherId 与请求用户一致）
- Metrics/Isolation: 所有统计按 `classroomTaskId` 聚合；窗口按 `AiFeedbackJob.updatedAt` 过滤
- Consistency/Constraints: `avgLatencyMs` 在当前 schema 无可计算字段时返回 `null`；feedback 仅统计 `source=AI`；不返回 `codeText/prompt/provider raw response/API key` 等敏感信息
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `AiFeedbackJobModel`, `FeedbackModel`；反馈统计严格按 `classroomTaskId` 过滤，必要时通过 submissions 关联完成隔离并避免 N+1；只读 aggregate
- Performance Notes: `$match` 前置；jobs 与 feedback 各 1 次 aggregate；`includeTags=false` 时跳过 tags 统计分支
- SoT: `backend/src/modules/classrooms/classroom-tasks/services/ai-metrics.service.ts`; `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts`
- Failure Modes:
  - 班级不存在/非 owner -> `404 Classroom not found`
  - 课堂任务不存在或不属于班级 -> `404 Classroom task not found`
  - `classroomId/classroomTaskId` 非法 -> `400`
  - `window/includeTags` 非法（DTO 校验） -> `400`

## Service Card 12

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-guards.service.ts`
- Domain: `AiFeedback Guards`
- Actions: `acquire-semaphore`, `release`, `consume-rate-limit`
- I/O Shape:
  - In: `classroomTaskId?`
  - Out: `releaseFn` | `boolean`
- Key Methods:
  - `acquire(): Promise<() => void> — called by processor before provider invocation to enforce max concurrency`
  - `tryConsume(classroomTaskId?: string | null): boolean — called by processor to enforce per-classroomTask soft rate limit`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 限流桶按 `classroomTaskId`（缺失时 `no-classroomTask`）；窗口 60 秒
- Consistency/Constraints: 并发默认 `2`；每课堂任务每分钟默认 `30`；map 过大触发清理
- Deps/Side Effects: `ConfigService`；维护内存队列与时间戳 map
- Performance Notes: O(window) 过滤 + 惰性清理；信号量队列限制突发并发
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-guards.service.ts`; `backend/src/config/env.validation.ts`
- Failure Modes:
  - 触发本地限流 -> `tryConsume=false`（processor 转 `RATE_LIMIT_LOCAL`）
  - 非法 env 值 -> 回退默认
  - release 重复调用 -> 幂等忽略

## Service Card 13

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`
- Domain: `AiFeedback Processor`
- Actions: `claim-job`, `call-provider`, `compact-items`, `persist-feedback`, `transition-failure`
- I/O Shape:
  - In: `batchSize`（默认 `5`）
  - Out: `{ processed: number; succeeded: number; failed: number; dead: number }`
- Key Methods:
  - `processOnce(batchSize?: number): Promise<{ processed: number; succeeded: number; failed: number; dead: number }> — called by worker tick and debug process-once endpoint`
- AuthZ Boundary: `internal-only`（worker 与 debug process-once 共享）
- Metrics/Isolation: job 按 `classroomTaskId` 进入限流桶；重试/backoff/attempts 状态机收敛
- Consistency/Constraints: 锁 TTL=5min；仅 claim `PENDING|FAILED`；指数退避（30s 起，最大 10min）；`UNAUTHORIZED/MISSING_API_KEY/REAL_DISABLED` 直接 `DEAD`；处理链路为“读取 submission -> 按 `submission.taskId` 查询 task -> 组装 `AiSubmissionAnalysisContext` -> 调 provider -> 落库前收敛”；收敛口径为默认 1 条主反馈、必要时最多 2 条；同类问题聚合、低价值 INFO（存在 ERROR/WARN 时）不独立落库
- Deps/Side Effects: `AiFeedbackJobModel`, `SubmissionModel`, `TaskModel`, `FeedbackModel`, `AI_FEEDBACK_PROVIDER_TOKEN`, `AiFeedbackGuardsService`, `ConfigService`, `feedback-item-compactor`；外部 provider 调用 + 反馈写库 + job 状态更新
- Performance Notes: `findOneAndUpdate` 原子 claim（按 createdAt 先来先服务）；`insertMany(ordered:false)` 批量落库并容忍重复键；收敛逻辑基于当前 job 的 `items[]` 内存处理，避免额外数据库 I/O
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/lib/feedback-item-compactor.ts`; `backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-provider.error-codes.ts`
- Failure Modes:
  - submission 不存在 -> 进入失败处理并重试/死亡
  - task 不存在 -> 进入失败处理并重试/死亡
  - 本地/上游限流 -> `FAILED` + 设置 `notBefore`
  - 凭据错误或 real 未启用 -> `DEAD`
  - provider 返回坏 JSON -> `BAD_RESPONSE`
  - feedback 重复键 -> 忽略重复，不中断 job

## Service Card 14

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`
- Domain: `AiFeedback Worker`
- Actions: `boot-if-enabled`, `schedule-tick`, `shutdown`
- I/O Shape:
  - In: `AI_FEEDBACK_WORKER_ENABLED`, `AI_FEEDBACK_WORKER_INTERVAL_MS`, `AI_FEEDBACK_WORKER_BATCH_SIZE`
  - Out: `void`
- Key Methods:
  - `onModuleInit(): void — called by Nest lifecycle to optionally start polling loop`
  - `onModuleDestroy(): void — called by Nest lifecycle to clear worker interval`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 复用 processor 统计结果；隔离口径由 processor 负责
- Consistency/Constraints: 默认禁用；`isRunning` 防重入；destroy 时清理 interval
- Deps/Side Effects: `AiFeedbackProcessor`；周期调度、日志输出
- Performance Notes: 定时批处理，batch 可配置；禁用时无轮询开销
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`
- Failure Modes:
  - 未开启 `AI_FEEDBACK_WORKER_ENABLED` -> 不启动 worker
  - processor 异常 -> 捕获并记录，worker 不崩溃
  - 非法 interval/batch env -> 回退默认值

## Provider Card A

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `analyze`, `rule-generate`, `normalize`
- I/O Shape:
  - In: `AiSubmissionAnalysisContext(codeText, language, task*)`
  - Out: `AiFeedbackItem[]`
- Key Methods:
  - `analyzeSubmission(context: AiSubmissionAnalysisContext): Promise<AiFeedbackItem[]> — called by processor when provider=stub`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 不依赖 `classroomTaskId`；只处理单提交内容
- Consistency/Constraints: 输出统一走 `normalizeFeedbackItems`；stub 仅读取 `context.codeText` 复用原有规则；空代码/短代码/TODO 行为与英文 message 保持原样
- Deps/Side Effects: `feedback-normalizer`；无外部 I/O
- Performance Notes: 纯内存规则，低成本
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider.ts`; `backend/src/modules/learning-tasks/ai-feedback/lib/feedback-normalizer.ts`
- Failure Modes:
  - 输入代码为空 -> 返回 validation 错误项
  - 未命中规则 -> 返回默认 info 项（`other`）

## Provider Card B

- Service: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openrouter-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `build-request`, `call-openrouter`, `parse-validate-json`, `map-provider-error`
- I/O Shape:
  - In: `AiSubmissionAnalysisContext`, `OPENROUTER_*`, `AI_FEEDBACK_*`
  - Out: `AiFeedbackItem[]`
- Key Methods:
  - `analyzeSubmission(context: AiSubmissionAnalysisContext): Promise<AiFeedbackItem[]> — called by processor when provider=openrouter`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 日志带 `submissionId/classroomTaskId/provider/model/duration/retried`
- Consistency/Constraints: 严格 JSON 协议；字段白名单；最多 `maxItems`；指数退避重试；system prompt 默认要求 `message/suggestion` 使用简体中文并保持代码元素原文；prompt 已加入“主问题导向综合反馈”约束（默认 1 条，必要时第 2 条；同类问题不按位置拆条；阻断运行问题优先；存在 ERROR/WARN 时不输出表扬型 INFO 噪音）；AI feedback prompt 现支持对 `codeText` 做语言无关的多文件文本边界识别，但默认仍按普通单文件分析，不要求无边界标记的提交补 `FILE` 标记；推荐标准边界为 `===== FILE: relative/path/FileName.ext =====`，并容错识别大小写不敏感关键词、仅文件名、关键词不规范及明显边界样式的弱边界；该能力仅由 prompt 引导模型完成，不做后端正则拆分、不新增 `codeFiles` 字段；只有强证据表明疑似多文件且边界不清时才保守提示，且 `CodeTruncated=true` 时不假定最后一个文件块完整；user prompt 纳入 `taskTitle/taskDescription/taskRubric/codeText/language/attemptNo/aiUsageDeclaration` 并要求结合题目要求分析
- Deps/Side Effects: `ConfigService`, `fetch` 外部网络调用、prompt/protocol/normalizer
- Performance Notes: 单请求超时控制 + 有界重试；解析失败直接终止
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openrouter-feedback.provider.ts`; `backend/src/modules/learning-tasks/ai-feedback/protocol/ai-feedback-json.protocol.ts`; `backend/src/modules/learning-tasks/ai-feedback/prompts/ai-feedback.prompt.ts`
- Failure Modes:
  - `AI_FEEDBACK_REAL_ENABLED=false` -> `REAL_DISABLED`（不可重试）
  - 无 API key -> `MISSING_API_KEY`（不可重试）
  - HTTP 429/5xx/超时 -> 可重试错误
  - 非法 JSON/越界字段 -> `BAD_RESPONSE`

## Provider Card C

- Service: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `analyze`, `throw-not-implemented`
- I/O Shape:
  - In: `AiSubmissionAnalysisContext`
  - Out: `throws Error`
- Key Methods:
  - `analyzeSubmission(context: AiSubmissionAnalysisContext): Promise<AiFeedbackItem[]> — 当前实现仅做统一契约签名适配，调用仍直接抛未实现错误`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 无
- Consistency/Constraints: 占位实现；未完成真实 OpenAI 接入；当前调用必抛错
- Deps/Side Effects: 无外部调用（当前）
- Performance Notes: 无
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`
- Failure Modes:
  - 任意调用都会抛出“未实现 + 需人工安装 SDK”错误

## Provider Card D

- Service: `backend/src/modules/learning-tasks/ai-feedback/providers/real/bailian-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `build-request`, `call-bailian`, `parse-validate-json`, `map-provider-error`
- I/O Shape:
  - In: `AiSubmissionAnalysisContext`, `BAILIAN_*`, `AI_FEEDBACK_*`
  - Out: `AiFeedbackItem[]`
- Key Methods:
  - `analyzeSubmission(context: AiSubmissionAnalysisContext): Promise<AiFeedbackItem[]> — called by processor when provider=bailian`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 日志带 `submissionId/classroomTaskId/provider=bailian/model/duration/retried`
- Consistency/Constraints: 走阿里云百炼 OpenAI Chat Completions 兼容接口；默认 `BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`BAILIAN_MODEL=qwen-plus`（生产可显式指定 `qwen3.6-plus`）；复用 OpenAI-compatible 基类中的 prompt、严格 JSON 协议、字段白名单、`<=2` 协议闸门、指数退避、超时与错误映射；不发送 OpenRouter 专属 `HTTP-Referer/X-Title` 请求头
- Deps/Side Effects: `ConfigService`, `fetch` 外部网络调用、prompt/protocol/normalizer
- Performance Notes: 单请求超时控制 + 有界重试；解析失败直接终止
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/bailian-feedback.provider.ts`; `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-compatible-feedback-provider.base.ts`; `backend/src/modules/learning-tasks/ai-feedback/protocol/ai-feedback-json.protocol.ts`; `backend/src/modules/learning-tasks/ai-feedback/prompts/ai-feedback.prompt.ts`
- Failure Modes:
  - `AI_FEEDBACK_REAL_ENABLED=false` -> `REAL_DISABLED`（不可重试）
  - 无 `BAILIAN_API_KEY` -> `MISSING_API_KEY`（不可重试）
  - HTTP 429/5xx/超时 -> 可重试错误
  - 非法 JSON/越界字段 -> `BAD_RESPONSE`

## Changelog（本次更新）

- 新增 Service Cards：
  - `Service Card 08A` `EnrollmentService`
  - `Service Card 08B` `TeacherClassroomWeeklyReportService`
  - `Service Card 08C` `CourseOverviewService`
  - `Service Card 08D` `Feature: My Task Detail (ClassroomTasksService#getMyTaskDetail)`
  - `Service Card 08E` `Feature: Learning Trajectory (ClassroomTasksService#getLearningTrajectory)`
  - `Service Card 08F` `ClassReviewPackService`
  - `Service Card 08G` `ProcessAssessmentService`
  - `Service Card 08H` `ClassroomExportSnapshotService`
- 修订 Service Cards：
  - `Service Card 04` `ClassroomsService`
  - `Service Card 05` `TeacherClassroomDashboardService`
  - `Service Card 06` `StudentLearningDashboardService`
  - `Service Card 07` `ClassroomTasksService`
  - `Service Card 08` `LearningTasksService`（补充 `getSubmissionDetail`、submission detail 权限边界、稳定读源与 `content.codeText` 返回口径）
  - `Service Card 13` `AiFeedbackProcessor`（补充 task 查询依赖、`AiSubmissionAnalysisContext` 组装、task 缺失失败链路）
- 修订 Provider Cards：
  - `Provider Card A` `DefaultStubAiFeedbackProvider`（输入契约切换为 `AiSubmissionAnalysisContext`；仅签名适配，规则逻辑与英文输出不变）
  - `Provider Card B` `OpenRouterFeedbackProvider`（输入契约切换为 `AiSubmissionAnalysisContext`；prompt 默认简体中文并纳入 task 上下文）
- 本轮补充：AI feedback 落库前收敛已落地（默认 1 条主反馈、必要时最多 2 条；同类问题聚合并过滤低价值 INFO 噪音）
  - `Provider Card C` `OpenAIFeedbackProvider`（输入契约切换为 `AiSubmissionAnalysisContext`；仍为占位实现）
- AI feedback 契约同步：`AiFeedbackProvider.analyzeSubmission` 已统一为 `analyzeSubmission(context: AiSubmissionAnalysisContext)`
- 本轮新增：`BailianFeedbackProvider`，通过 `AI_FEEDBACK_PROVIDER=bailian` 启用；OpenRouter 保留并继续通过 `AI_FEEDBACK_PROVIDER=openrouter` 启用；两者共用 `openai-compatible-feedback-provider.base.ts` 保持 JSON 协议、重试、超时和错误口径一致。
