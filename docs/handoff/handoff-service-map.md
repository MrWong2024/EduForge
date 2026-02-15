# 服务职责地图（Service Cards）

扫描范围：`backend/src/modules/**` 下全部 `*service.ts`。  
补充：为满足 Provider 交接完整性，附带 `*.provider.ts` 卡片。

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
- Actions: `login`, `logout`, `validate-session`, `trim-sessions`
- I/O Shape:
  - In: `LoginDto(email,password)`, `token`
  - Out: `sessionToken + user profile` | `void` | `userId|null`
- Key Methods:
  - `onModuleInit(): Promise<void> — called by Nest lifecycle to ensure session indexes exist`
  - `login(dto: LoginDto): Promise<{ sessionToken: string; user: Record<string, unknown> }> — called by auth login controller`
  - `logout(token?: string): Promise<void> — called by auth logout controller`
  - `validateSession(token?: string): Promise<string | null> — called by SessionAuthGuard for request authentication`
- AuthZ Boundary: `login-only`（由 controller/guard 接入；不做角色鉴权）
- Metrics/Isolation: 会话治理按 `userId`，与 `classroomTaskId` 无关
- Consistency/Constraints: 会话上限 `N=5`；`expiresAt` + TTL 索引；模块启动执行 `ensureIndexes()`
- Deps/Side Effects: `UserModel`, `SessionModel`, `bcrypt.compare`, `randomBytes`；写入/删除 sessions
- Performance Notes: 旧会话清理用 `sort(createdAt:-1)+skip(N)` 批量删除
- SoT: `docs/auth-baseline.md`; `backend/src/modules/auth/schemas/session.schema.ts`; `backend/src/modules/auth/auth.constants.ts`
- Failure Modes:
  - 凭据错误 -> `401 Unauthorized`
  - token 缺失/失效 -> `validateSession` 返回 `null`
  - session 过期 -> 删除会话并返回 `null`

## Service Card 02

- Service: `backend/src/modules/users/services/users.service.ts`
- Domain: `User`
- Actions: `get-me`, `update-me(placeholder)`
- I/O Shape:
  - In: `userId`, `UpdateProfileDto`
  - Out: `user public entity` | `null`
- Key Methods:
  - `getMe(userId: string): Promise<Record<string, unknown>> — called by /users/me endpoint`
  - `updateMe(dto: UpdateProfileDto): null — placeholder called by PATCH /users/me`
- AuthZ Boundary: `login-only`
- Metrics/Isolation: 无 `classroomTaskId` 口径
- Consistency/Constraints: 返回字段白名单（不含 `passwordHash`）
- Deps/Side Effects: `UserModel`；只读查询
- Performance Notes: `lean + select` 最小字段读取
- SoT: `backend/src/modules/users/services/users.service.ts`; `backend/src/modules/users/schemas/user.schema.ts`
- Failure Modes:
  - 用户不存在 -> `404 User not found`
  - 更新接口当前未实现 -> 返回 `null`

## Service Card 03

- Service: `backend/src/modules/courses/services/courses.service.ts`
- Domain: `Course`
- Actions: `create`, `update`, `list`, `archive`
- I/O Shape:
  - In: `Create/Update/QueryCourseDto`, `courseId`, `userId`
  - Out: `CourseResponseDto` | `{ items, total, page, limit }`
- Key Methods:
  - `createCourse(dto: CreateCourseDto, userId: string): Promise<CourseResponseDto> — called by POST /courses`
  - `updateCourse(id: string, dto: UpdateCourseDto, userId: string): Promise<CourseResponseDto> — called by PATCH /courses/:id`
  - `listCourses(query: QueryCourseDto, userId: string): Promise<{ items: CourseResponseDto[]; total: number; page: number; limit: number }> — called by GET /courses`
  - `getCourse(id: string, userId: string): Promise<CourseResponseDto> — called by GET /courses/:id`
  - `archiveCourse(id: string, userId: string): Promise<CourseResponseDto> — called by POST /courses/:id/archive`
- AuthZ Boundary: `teacher-only`（service 内 `ensureTeacher` 强校验）
- Metrics/Isolation: 按 `createdBy(userId)` 做课程隔离
- Consistency/Constraints: `unique(createdBy,code)`；归档课程禁止更新；分页上限 `100`
- Deps/Side Effects: `CourseModel`, `UserModel`；写课程文档
- Performance Notes: `find + countDocuments` 并发执行，避免串行等待
- SoT: `backend/src/modules/courses/schemas/course.schema.ts`; `backend/src/modules/courses/dto/query-course.dto.ts`
- Failure Modes:
  - 非教师 -> `403 Not allowed to manage courses`
  - 课程不存在 -> `404`
  - 重复 code(`11000`) -> `400 Course code already exists`

## Service Card 04

- Service: `backend/src/modules/classrooms/services/classrooms.service.ts`
- Domain: `Classroom`
- Actions: `create/update/list/get`, `join/remove`, `archive`, `dashboard-delegate`
- I/O Shape:
  - In: `classroomId`, `JoinClassroomDto(joinCode)`, `QueryClassroomDto`, `userId`
  - Out: `ClassroomResponseDto` | `{ items, total, page, limit }` | `dashboard aggregate`
- Key Methods:
  - `createClassroom(dto: CreateClassroomDto, userId: string): Promise<ClassroomResponseDto> — called by POST /classrooms`
  - `listClassrooms(query: QueryClassroomDto, userId: string): Promise<{ items: ClassroomResponseDto[]; total: number; page: number; limit: number }> — called by GET /classrooms`
  - `joinClassroom(dto: JoinClassroomDto, userId: string): Promise<ClassroomResponseDto> — called by POST /classrooms/join`
  - `getDashboard(id: string, userId: string): Promise<Record<string, unknown>> — delegates to teacher dashboard service`
  - `getMyLearningDashboard(query: QueryClassroomDto, userId: string): Promise<Record<string, unknown>> — delegates to student dashboard service`
- AuthZ Boundary: `teacher-only`（管理） / `student-only`（加入） / `member-or-owner`（查看）
- Metrics/Isolation: 班级层隔离按 `teacherId` 与 `studentIds`；下游统计委托 dashboard service（`classroomTaskId` 口径）
- Consistency/Constraints: joinCode 生成重试上限 `8`；归档班级禁止更新/发布任务
- Deps/Side Effects: `ClassroomModel`, `CourseModel`, `UserModel`, `TeacherClassroomDashboardService`, `StudentLearningDashboardService`
- Performance Notes: 列表查询分页 + 索引过滤；join/remove 用 `$addToSet/$pull` 原子更新
- SoT: `backend/src/modules/classrooms/schemas/classroom.schema.ts`; `backend/src/modules/classrooms/services/classrooms.service.ts`
- Failure Modes:
  - 非授权角色 -> `403`
  - 班级/课程不存在 -> `404`
  - joinCode 冲突或分配失败 -> `400 Unable to allocate join code`

## Service Card 05

- Service: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`
- Domain: `ClassroomTask + Submission + Feedback + AiFeedbackJob`
- Actions: `aggregate-classroom-tasks`, `aggregate-submissions`, `aggregate-ai-status`, `build-dashboard`
- I/O Shape:
  - In: `classroomId`, `teacherUserId`
  - Out: `teacher dashboard aggregate`
- Key Methods:
  - `getDashboard(id: string, userId: string): Promise<Record<string, unknown>> — called by ClassroomsService.getDashboard and /classrooms/:id/dashboard`
- AuthZ Boundary: `teacher-only + owner-only`（先校验班级 teacherId）
- Metrics/Isolation: 强制按 `classroomTaskId` 聚合；`notRequested = submissionsCount - requestedCount`（下限 0）
- Consistency/Constraints: 仅统计 `FeedbackSource.AI` 的 tags；top tags 限制 `5`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `FeedbackModel`, `AiFeedbackJobModel`；只读聚合
- Performance Notes: 多个 `aggregate` 并行 + Map 合并，避免逐 task N+1
- SoT: `backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/schemas/ai-feedback-job.schema.ts`; `backend/src/modules/learning-tasks/schemas/submission.schema.ts`
- Failure Modes:
  - 非班级教师或班级不存在 -> `404 Classroom not found`
  - 班级无发布任务 -> 返回空 tasks 结构（非异常）
  - 聚合结果缺项 -> 用 `0` 补齐计数，防止负值/空引用

## Service Card 06

- Service: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`
- Domain: `ClassroomTask + Submission + AiFeedbackStatus`
- Actions: `list-my-classrooms`, `aggregate-classroom-tasks`, `pick-latest-submission`, `map-status`
- I/O Shape:
  - In: `QueryClassroomDto(page,limit,status)`, `userId`
  - Out: `student dashboard aggregate`
- Key Methods:
  - `getMyLearningDashboard(query: QueryClassroomDto, userId: string): Promise<Record<string, unknown>> — called by ClassroomsService and /classrooms/mine/dashboard`
- AuthZ Boundary: `student-only`（由上层 `ClassroomsService.ensureStudent` 保障）
- Metrics/Isolation: 全程按 `classroomTaskId` 归并提交；最新提交判定 `attemptNo` 优先，其次 `createdAt`
- Consistency/Constraints: 无 job 记录时状态回退 `NOT_REQUESTED`
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `SubmissionModel`, `AiFeedbackJobService`；只读
- Performance Notes: 先批量取班级任务，再批量取 submissions/statusMap，避免按班级循环查库
- SoT: `backend/src/modules/classrooms/services/student-learning-dashboard.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-status.enum.ts`
- Failure Modes:
  - 学生未加入任何班级 -> 返回空 `items`
  - 某任务无提交 -> `myLatestSubmission=null`
  - 某提交无 job -> `aiFeedbackStatus=NOT_REQUESTED`

## Service Card 07

- Service: `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`
- Domain: `ClassroomTask + Submission`
- Actions: `publish-to-classroom`, `list/get-classroom-task`, `submit-classroom-task`
- I/O Shape:
  - In: `classroomId`, `classroomTaskId`, `CreateClassroomTaskDto`, `QueryClassroomTaskDto`, `CreateSubmissionDto`, `userId`
  - Out: `ClassroomTaskResponseDto` | `{ items, total, page, limit }` | `SubmissionResponseDto`
- Key Methods:
  - `createClassroomTask(classroomId: string, dto: CreateClassroomTaskDto, userId: string): Promise<ClassroomTaskResponseDto> — called by POST /classrooms/:id/tasks`
  - `listClassroomTasks(classroomId: string, query: QueryClassroomTaskDto, userId: string): Promise<{ items: ClassroomTaskResponseDto[]; total: number; page: number; limit: number }> — called by GET /classrooms/:id/tasks`
  - `getClassroomTask(classroomId: string, classroomTaskId: string, userId: string): Promise<ClassroomTaskResponseDto> — called by GET /classrooms/:id/tasks/:classroomTaskId`
  - `createClassroomTaskSubmission(classroomId: string, classroomTaskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by classroom-task submission endpoint`
- AuthZ Boundary: `teacher-only`（发布） / `student-only + member-only`（提交） / `member-or-owner`（查看）
- Metrics/Isolation: 学生提交通过 `createSubmissionForClassroomTask(..., classroomTaskId)` 绑定隔离主键；ai-metrics 统计按 `classroomTaskId` 隔离；owner 校验由上层保障；与学习任务提交链路通过 `LearningTasksService` 协作
- Consistency/Constraints: 要求 Task 已 `PUBLISHED`；班级 `ARCHIVED` 禁止发布；`unique(classroomId,taskId)` 防重复发布
- Deps/Side Effects: `ClassroomModel`, `ClassroomTaskModel`, `TaskModel`, `UserModel`, `LearningTasksService`
- Performance Notes: 列表使用 `aggregate(basePipeline + totalPipeline)` 一次生成分页数据与总数
- SoT: `backend/src/modules/classrooms/classroom-tasks/schemas/classroom-task.schema.ts`; `backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts`
- Failure Modes:
  - 班级/任务/课堂任务不存在 -> `404`
  - 无权限访问或提交 -> `403`
  - 重复发布(`11000`) -> `400 Task already published to classroom`

## Service Card 08

- Service: `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`
- Domain: `Task|Submission|Feedback|AiFeedbackJob`
- Actions: `manage-task`, `submit`, `request-ai-feedback`, `feedback`, `stats`
- I/O Shape:
  - In: `taskId/submissionId/classroomTaskId`, `Create/Update DTO`, `RequestAiFeedbackDto`, `filters/page/limit`, `user/userId`
  - Out: `TaskResponseDto` | `SubmissionResponseDto` | `FeedbackResponseDto` | `list/paged list/aggregate`
- Key Methods:
  - `createTask(dto: CreateTaskDto, userId: string): Promise<TaskResponseDto> — called by POST /learning-tasks/tasks`
  - `createSubmission(taskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by generic task submission endpoint`
  - `createSubmissionForClassroomTask(taskId: string, classroomTaskId: string, dto: CreateSubmissionDto, userId: string): Promise<SubmissionResponseDto> — called by ClassroomTasksService for isolated submissions`
  - `requestAiFeedback(submissionId: string, user: { id: string; roles?: string[] }, dto: RequestAiFeedbackDto): Promise<{ submissionId: string; jobId: string; status: AiFeedbackJobStatus; aiFeedbackStatus: AiFeedbackStatus }> — called by POST /learning-tasks/submissions/:submissionId/ai-feedback/request`
  - `listTaskSubmissions(taskId: string, userId: string, page?: number, limit?: number): Promise<{ items: SubmissionResponseDto[]; total: number; page: number; limit: number }> — called by teacher submissions endpoint`
  - `getStats(taskId: string, userId: string): Promise<Record<string, unknown>> — called by /learning-tasks/tasks/:id/stats`
- AuthZ Boundary: `teacher-owner`（更新/查看任务提交/反馈写入/统计/手工 request） + `student`（提交/查自己提交/对本人 submission 手工 request）
- Metrics/Isolation: `Submission.classroomTaskId` 可选；`aiFeedbackStatus` 通过 `AiFeedbackJobService` 推导；top tags 由 feedback 聚合
- Consistency/Constraints: attemptNo 采用“查询最新 + 最多 3 次重试”；仅 `PUBLISHED` 任务可提交；自动入队采用 attempt-based 策略：默认 `attemptNo==1` 自动入队、`attemptNo>1` 返回 `NOT_REQUESTED`；策略受 `AI_FEEDBACK_AUTO_ON_SUBMIT`（默认 true）与 `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`（默认 true）控制；“跳过 enqueue”属于正常策略路径，不是失败
- Deps/Side Effects: `ConfigService`, `TaskModel`, `SubmissionModel`, `FeedbackModel`, `ClassroomTaskModel`, `ClassroomModel`, `AiFeedbackJobService`；提交后按 env 策略决定是否 `enqueue`，手工 request 走 `ensureJobForSubmission` 幂等创建
- Performance Notes: 批量查询 + `Promise.all`；状态映射批量取 jobs，避免逐提交查询
- SoT: `backend/src/modules/learning-tasks/schemas/submission.schema.ts`; `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts`; `backend/src/modules/learning-tasks/services/learning-tasks.service.ts`; `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts`
- Failure Modes:
  - 任务/提交不存在 -> `404`
  - 非任务创建者访问教师视图 -> `403`
  - 任务未发布 -> `400 Task is not published`
  - attemptNo 分配冲突连续失败 -> `400 Unable to allocate attempt number`

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
  - 未知 job status -> 映射为 `FAILED` 并记录 warn/debug 日志（防止与“无 job=NOT_REQUESTED”语义混淆）

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
- Actions: `claim-job`, `call-provider`, `persist-feedback`, `transition-failure`
- I/O Shape:
  - In: `batchSize`（默认 `5`）
  - Out: `{ processed: number; succeeded: number; failed: number; dead: number }`
- Key Methods:
  - `processOnce(batchSize?: number): Promise<{ processed: number; succeeded: number; failed: number; dead: number }> — called by worker tick and debug process-once endpoint`
- AuthZ Boundary: `internal-only`（worker 与 debug process-once 共享）
- Metrics/Isolation: job 按 `classroomTaskId` 进入限流桶；重试/backoff/attempts 状态机收敛
- Consistency/Constraints: 锁 TTL=5min；仅 claim `PENDING|FAILED`；指数退避（30s 起，最大 10min）；`UNAUTHORIZED/MISSING_API_KEY/REAL_DISABLED` 直接 `DEAD`
- Deps/Side Effects: `AiFeedbackJobModel`, `SubmissionModel`, `FeedbackModel`, `AI_FEEDBACK_PROVIDER_TOKEN`, `AiFeedbackGuardsService`；外部 provider 调用 + 反馈写库 + job 状态更新
- Performance Notes: `findOneAndUpdate` 原子 claim（按 createdAt 先来先服务）；`insertMany(ordered:false)` 批量落库并容忍重复键
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/interfaces/ai-feedback-provider.error-codes.ts`; `backend/src/modules/learning-tasks/ai-feedback/README.md`
- Failure Modes:
  - submission 不存在 -> 进入失败处理并重试/死亡
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
- SoT: `backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-worker.service.ts`; `backend/src/modules/learning-tasks/ai-feedback/README.md`
- Failure Modes:
  - 未开启 `AI_FEEDBACK_WORKER_ENABLED` -> 不启动 worker
  - processor 异常 -> 捕获并记录，worker 不崩溃
  - 非法 interval/batch env -> 回退默认值

## Provider Card A

- Service: `backend/src/modules/learning-tasks/ai-feedback/services/default-stub-ai-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `analyze`, `rule-generate`, `normalize`
- I/O Shape:
  - In: `Submission(content.codeText, language)`
  - Out: `AiFeedbackItem[]`
- Key Methods:
  - `analyzeSubmission(submission: Submission): Promise<AiFeedbackItem[]> — called by processor when provider=stub`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 不依赖 `classroomTaskId`；只处理单提交内容
- Consistency/Constraints: 输出统一走 `normalizeFeedbackItems`；空代码/短代码/TODO 有固定行为
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
  - In: `SubmissionDocument`, `OPENROUTER_*`, `AI_FEEDBACK_*`
  - Out: `AiFeedbackItem[]`
- Key Methods:
  - `analyzeSubmission(submission: SubmissionDocument): Promise<AiFeedbackItem[]> — called by processor when provider=openrouter`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 日志带 `submissionId/classroomTaskId/provider/model/duration/retried`
- Consistency/Constraints: 严格 JSON 协议；字段白名单；最多 `maxItems`；指数退避重试
- Deps/Side Effects: `ConfigService`, `fetch` 外部网络调用、prompt/protocol/normalizer
- Performance Notes: 单请求超时控制 + 有界重试；解析失败直接终止
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openrouter-feedback.provider.ts`; `backend/src/modules/learning-tasks/ai-feedback/protocol/ai-feedback-json.protocol.ts`; `backend/src/modules/learning-tasks/ai-feedback/prompts/openrouter-feedback.prompt.ts`
- Failure Modes:
  - `REAL_ENABLED=false` -> `REAL_DISABLED`（不可重试）
  - 无 API key -> `MISSING_API_KEY`（不可重试）
  - HTTP 429/5xx/超时 -> 可重试错误
  - 非法 JSON/越界字段 -> `BAD_RESPONSE`

## Provider Card C

- Service: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`
- Domain: `AiFeedback Provider`
- Actions: `analyze`, `throw-not-implemented`
- I/O Shape:
  - In: `Submission`
  - Out: `throws Error`
- Key Methods:
  - `analyzeSubmission(submission: Submission): Promise<AiFeedbackItem[]> — selected by provider factory if future openai provider is wired`
- AuthZ Boundary: `internal-only`
- Metrics/Isolation: 无
- Consistency/Constraints: 占位实现；当前调用必抛错
- Deps/Side Effects: 无外部调用（当前）
- Performance Notes: 无
- SoT: `backend/src/modules/learning-tasks/ai-feedback/providers/real/openai-feedback.provider.ts`
- Failure Modes:
  - 任意调用都会抛出“未实现 + 需人工安装 SDK”错误
