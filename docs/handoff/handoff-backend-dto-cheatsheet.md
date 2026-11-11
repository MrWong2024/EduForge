# DTO / Public Data Contract Cheatsheet

## Scope / Owner

本文按领域与 DTO / response family 维护稳定公开数据合同，回答“输入和返回数据长什么样、如何校验与转换”。源码是最高事实源；只覆盖既有 handoff 依赖的合同，不追求穷举仓库全部内部类型。

- 本文拥有 Body / Query / Param、validation / transform / whitelist、enum、default / nullable / optional、nested shape、兼容字段及敏感字段省略。
- Method/runtime Path、鉴权、资源归属、状态流转、HTTP 错误和副作用见 [Backend API Map](./handoff-backend-api-map.md)；内部配对、聚合、查询、排序与性能策略见 [Service Map](./handoff-backend-service-map.md)。
- 前端消费与展示分别见 [Frontend API Map](./handoff-frontend-api-map.md) 和 [Route Map](./handoff-frontend-route-map.md)；验收规则见 [Testing Playbook](./handoff-backend-testing-playbook.md)。

## 更新规则（必须遵守）

- 公开数据变化时更新对应 DTO / response family，并核对 DTO、Controller 实际绑定与 response mapper；不恢复逐 endpoint 模板或重复 endpoint inventory。
- 无公开请求数据的入口不单独建卡；示例仅用于澄清 nested、nullable 或兼容合同。未列出的内部对象不得据此视为公开 response。
- 权限、生命周期、错误矩阵、副作用与内部计算步骤只链接其 Owner；删除旧字段说明前确认承接位置，不丢失唯一稳定 public contract。

## 阅读约定

- `?` 表示可省略；`T | null` 表示显式 null。TypeScript 中的 `Date` 经 HTTP JSON 序列化为日期字符串；不能把所有可省略字段假定为 null。
- 下文“分页校验”统一指可选 `page` 经 `Type(Number) + IsInt + Min(1)`、`limit` 经同样转换且范围 `1..100`；默认值按各 family 说明，不能把一个报表的默认值套给另一个。
- DTO 的 `IsOptional` 会跳过 undefined/null；正文单列有清空语义或使用 `ValidateIf` 的字段。未声明的 body 字段不能作为可写合同。
- 资源 Param 使用字符串 id；MongoId 格式约束由对应 DTO / Service 的 id 校验承担，不要求客户端发送 ObjectId 对象。`excludedTaskIds` 在课堂报表中指 `classroomTaskId`。
- `IsBooleanString` 的校验集合与最终布尔解析必须分开看：相关 DTO 接受 `true/false/1/0` 字符串，哪些值启用选项以各 family 说明为准。

## Auth

### 登录与 Password Reset 输入

来源：[LoginDto](../../backend/src/modules/auth/dto/login.dto.ts)、[ForgotPasswordDto](../../backend/src/modules/auth/dto/forgot-password.dto.ts)、[ResetPasswordDto](../../backend/src/modules/auth/dto/reset-password.dto.ts)。

| DTO | 必填字段与 validation / transform |
| --- | --- |
| `LoginDto` | `email: string` 用 `IsEmail`；`password: string` 用 `IsString + MinLength(6)`；DTO 不声明 trim。 |
| `ForgotPasswordDto` | `email: string`，trim + lowercase，再 `IsString + IsEmail`。 |
| `ResetPasswordDto` | `token: string`，trim 后 `IsString + MinLength(1)`；`newPassword: string`，trim 后 `IsString`，长度上下界引用 `USER_PASSWORD_MIN_LENGTH / USER_PASSWORD_MAX_LENGTH`，并由共享密码校验 helper 校验。 |

### Auth public responses

来源：[AuthController](../../backend/src/modules/auth/controllers/auth.controller.ts)、[PasswordResetService](../../backend/src/modules/auth/services/password-reset.service.ts)。

- 登录返回用户投影 `{id,email,roles,status,createdAt}`；session token 不在 JSON 中返回。
- 忘记密码返回 `{message: "如果邮箱存在，我们将发送密码重置邮件。"}`；重置成功返回 `{message: "密码已重置，请使用新密码登录。"}`。
- Password Reset response 不返回 reset token、token hash、密码、passwordHash、凭据或用户内部对象。
- 注销使用 `{ok:true}`。公开性、防枚举、冷却和会话行为仅见 [API Auth](./handoff-backend-api-map.md#auth)。

## Users

### Profile 与 ChangePassword

来源：[UpdateProfileDto](../../backend/src/modules/users/dto/update-profile.dto.ts)、[ChangePasswordDto](../../backend/src/modules/users/dto/change-password.dto.ts)、[UsersService](../../backend/src/modules/users/services/users.service.ts)。

| Family | 公开输入 |
| --- | --- |
| `UpdateProfileDto` | 可选字符串 `name` 最长 100，`studentNo/employeeNo` 各最长 64；允许 `{}`，不要发送 JSON `null`。白名单仅这三个字段，不接受 `email/roles/status/passwordHash`。 |
| `ChangePasswordDto` | 必填 `currentPassword`：字符串 1..128；必填 `newPassword`：字符串 8..128。新密码另做 trim 后非空校验，不能与当前密码相同；不接受目标 `userId`。 |

当前用户读取与资料更新共用公开投影 `{id,email,roles,status,name?,studentNo?,employeeNo?,createdAt}`，不返回 `passwordHash`。改密成功数据为 `{ok:true}`；会话副作用见 [API Users](./handoff-backend-api-map.md#users)。

## Courses

### Course DTO / response family

来源：[CreateCourseDto](../../backend/src/modules/courses/dto/create-course.dto.ts)、[UpdateCourseDto](../../backend/src/modules/courses/dto/update-course.dto.ts)、[QueryCourseDto](../../backend/src/modules/courses/dto/query-course.dto.ts)、[CourseResponseDto](../../backend/src/modules/courses/dto/course-response.dto.ts)。

| DTO | 字段合同 |
| --- | --- |
| `CreateCourseDto` | 必填字符串 `code/name/term`；可选 `courseLabel`，trim，空白转 undefined，`IsIn(TASK_COURSE_LABELS)`。 |
| `UpdateCourseDto` | 可选字符串 `code/name/term`；可选 `status: ACTIVE \| ARCHIVED`；`courseLabel` 共用分类白名单，trim 后空白转 null，表示清空。 |
| `QueryCourseDto` | 可选字符串 `term`、枚举 `status: ACTIVE \| ARCHIVED`，以及分页校验。 |

`CourseResponseDto`：`{id,code,name,term,courseLabel?,status,createdBy,createdAt,updatedAt}`。`courseLabel` 与 Task 共用 `TASK_COURSE_LABELS`，是可空的单选课程分类，不是外键。课程状态及归档期间编辑边界见 [API Courses](./handoff-backend-api-map.md#courses)；总览数据见[课程总览](#课程总览)。

## Classrooms

### Classroom 与正式成员 family

来源：[CreateClassroomDto](../../backend/src/modules/classrooms/dto/create-classroom.dto.ts)、[UpdateClassroomDto](../../backend/src/modules/classrooms/dto/update-classroom.dto.ts)、[JoinClassroomDto](../../backend/src/modules/classrooms/dto/join-classroom.dto.ts)、[QueryClassroomDto](../../backend/src/modules/classrooms/dto/query-classroom.dto.ts)、[ClassroomResponseDto](../../backend/src/modules/classrooms/dto/classroom-response.dto.ts)。

- 创建必填 `courseId`（`IsMongoId`）、`name`（`IsString`）；更新允许可选字符串 `name` 与枚举 `status: ACTIVE | ARCHIVED`；入班必填字符串 `joinCode`。
- `QueryClassroomDto`：可选 MongoId `courseId`、枚举 `status: ACTIVE | ARCHIVED` 与分页校验。
- `ClassroomResponseDto`：`{id,courseId,course?,name,teacherId,joinCode,status,createdAt,updatedAt}`，不再输出 `studentIds`。只读 `course` 是 `{id,code?,name?,term?,courseLabel?,status?}`；关联缺失可省略，`courseId` 保留。成员权威边界见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。
- [QueryClassroomStudentsDto](../../backend/src/modules/classrooms/dto/query-classroom-students.dto.ts)：分页校验，默认 `page=1,limit=20`；`includeRemoved?` 用 `IsBooleanString`，默认 false，`1/true` 启用。返回 `{items,total,page,limit}`，成员 item 为 `{id,email,roles,status,name,studentNo,employeeNo,joinedAt}`，不返回 `passwordHash`。成员状态筛选及默认排序见 API / [Service Card 04](./handoff-backend-service-map.md#service-card-04)。

### Teacher / Student Dashboard response family

来源：[TeacherClassroomDashboardService](../../backend/src/modules/classrooms/services/teacher-classroom-dashboard.service.ts)、[StudentLearningDashboardService](../../backend/src/modules/classrooms/services/student-learning-dashboard.service.ts)。

| 输入 | 公开解析 |
| --- | --- |
| 教师看板 `includeClosedTasks` | Controller 单独绑定；仅布尔 true 或字符串 `"true"` 启用，默认 false，无独立 Query DTO。 |
| [QueryStudentDashboardDto](../../backend/src/modules/classrooms/dto/query-student-dashboard.dto.ts) | 继承 `QueryClassroomDto`；`includeHistorical?` 经 Transform 将 true / `"true"` 转为 true，其余值转为 false，再 `IsBoolean`；默认 false。 |

教师看板返回 `{classroom,summary,archiveSuggestion,tasks}`：

- `classroom`：`{id,name,courseId,status,joinCode}`。
- `summary`：`{studentsCount,publishedTasksCount,lateSubmissionsTotal,lateStudentsTotal}`。
- `tasks[]`：`{classroomTaskId,classroomTaskStatus,taskId,taskPublisher,taskTemplateStatus,title,knowledgeModule,publishedAt,dueAt,submissionsCount,distinctStudentsSubmitted,lateSubmissionsCount,lateDistinctStudentsCount,aiFeedback,topTags}`。
- `taskTemplateStatus` 为 `DRAFT | PUBLISHED | ARCHIVED | null`；`taskPublisher` 为 `{id,name?} | null`，不含完整 User；`dueAt` 可为 null。`aiFeedback` 包含 `pending/running/succeeded/failed/dead/notRequested` 数量；`topTags` 是 `{tag,count}[]`。
- `archiveSuggestion`：`{suggested:boolean,reason,message,lastSubmissionAt,latestActiveTaskDueAt,inactiveDays}`；后五项均可为 null。`reason` 非空值为 `NO_ACTIVE_TASKS | NO_RECENT_SUBMISSIONS | NO_ACTIVE_TASKS_AND_NO_RECENT_SUBMISSIONS`；时间为字符串，`inactiveDays` 为 number。判定过程见 [Service Card 05](./handoff-backend-service-map.md#service-card-05)。

学生看板返回 `{items,total,page,limit}`；`items[]` 为 `{classroom,tasks}`，`total` 是最终班级分组数。

- `classroom`：`{id,name,courseId,status,teacher,course}`。`teacher={id,name,employeeNo}`；`course={id,name,term,code}`。关联记录缺失仍保留 id，文本缺失或空白为 null。
- 教师摘要无 email；课程摘要无 `courseLabel/createdBy/status/createdAt/updatedAt`；均不返回完整关联对象。
- `tasks[]`：`{classroomTaskId,taskId,title,publishedAt,dueAt,studentVisibilityStatus,isHistorical,myLatestSubmission,mySubmissionsCount,completionStatus}`；时间字段可为 null；`myLatestSubmission` 为 `{submissionId,attemptNo,createdAt,aiFeedbackStatus} | null`，无提交时数量为 0。
- `studentVisibilityStatus: CURRENT | RECENTLY_EXPIRED | HISTORICAL`，稳定必返；`isHistorical` 是相应布尔标志。时间窗口与访问过滤见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。

### Student completion / participation public state

看板与 my-task-detail 共用 [TaskCompletionStatus](../../backend/src/modules/classrooms/services/student-task-completion-status.ts)，稳定必返，不等同于 AI job 状态：

| 字段 | 值域 / 空值合同 |
| --- | --- |
| `status` | `NOT_SUBMITTED \| NO_FEEDBACK \| QUALIFIED \| QUALIFIED_WITH_WARNINGS \| UNQUALIFIED`；分别表示未提交、无可用评价、合格、带警告合格、不合格。 |
| `severity` | `INFO \| WARN \| ERROR \| null`；有评价的三个结果分别对应 INFO / WARN / ERROR。 |
| `source` | `TEACHER \| AI \| null`；表示完成态所采用的评价来源。 |
| `latestSubmissionId` | `string \| null`，关联当前课堂任务内最新提交。 |
| `teacherFeedbackCount / aiFeedbackCount` | number，默认 0；与各来源最严重程度 `teacherWorstSeverity / aiWorstSeverity`（`INFO \| WARN \| ERROR \| null`）同时返回。 |

未提交时 `status=NOT_SUBMITTED`，id/source/severity/两类 worst severity 均为 null、数量均为 0；已提交但无可用评价时 `status=NO_FEEDBACK`，保留提交 id，source/severity 为 null。来源优先与完成态推导仅见 [Service Card 08D](./handoff-backend-service-map.md#service-card-08dfeature-my-task-detail-z3)。

my-task-detail 另稳定返回 `participationStatus={readOnly,canSubmit,canRequestAiFeedback,reason,message}`：

| `reason` | `readOnly` | `canSubmit / canRequestAiFeedback` | `message` |
| --- | --- | --- | --- |
| `ACTIVE` | 有快照时 false，否则 true | 有快照时均 true，否则均 false | null |
| `CLASSROOM_NOT_ACTIVE` | true | false / false | 班级已归档或不可参与，仅可查看历史提交与反馈。 |
| `CLASSROOM_TASK_NOT_ACTIVE` | true | false / false | 课堂任务已关闭或不可参与，仅可查看历史提交与反馈。 |

正常 my-task-detail 响应在班级/实例 ACTIVE 时，canSubmit/canRequestAiFeedback 均为 true；缺失或结构异常快照按 API 合同拒绝该聚合详情。旧策略字段缺失或残留均不影响投影。这些值是展示信号；动作授权边界和原因优先级见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。

## Classroom Tasks（Classrooms 子资源）

### ClassroomTask DTO / response family

来源：[CreateClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/create-classroom-task.dto.ts)、[UpdateClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task.dto.ts)、[UpdateClassroomTaskStatusDto](../../backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task-status.dto.ts)、[ClassroomTaskResponseDto](../../backend/src/modules/classrooms/classroom-tasks/dto/classroom-task-response.dto.ts)。

| DTO | 字段合同 |
| --- | --- |
| `CreateClassroomTaskDto` | 必填 `taskId`（MongoId）；可选 `dueAt`（DateString）；可选 nested `settings` 用 `ValidateNested + Type`，仅接受 `allowLate?`（Boolean）。省略 settings 或传 {} 时 allowLate 默认 true，显式 false 保留。`settings.maxAttempts` 与 `settings.aiFeedbackMode` 已退役，夹带任何值（包括 null）均由严格白名单返回 400；不保存默认策略或替代字段。发布请求不能指定 taskSnapshot。 |
| `UpdateClassroomTaskDto` | 至少一个扁平字段：`dueAt?`（DateString，null/空字符串清空）、`allowLate?`（Boolean，null 不合法）；空 PATCH 返回 400。不接受 `taskId/classroomId/publishedAt/createdBy/status/taskSnapshot/aiFeedbackMode/maxAttempts` 或 nested `settings`；退役的 maxAttempts 包括 null 均返回 400，与合法字段混用也整单拒绝。 |
| `UpdateClassroomTaskStatusDto` | 必填 `status`，`IsIn` 值域 `ACTIVE \| CLOSED \| RECALLED`。允许值不等同于允许状态转换，见 API Owner。 |
| [QueryClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-classroom-task.dto.ts) | 分页校验；可选 `status` 使用 `TaskStatus`（`DRAFT \| PUBLISHED \| ARCHIVED`），不要误当为实例状态筛选枚举。 |

更新的扁平 `allowLate` 在返回数据中位于 `settings`；清空截止时间示例：

```json
{"dueAt": null}
```

`ClassroomTaskResponseDto`：`{id,classroomId,taskId,taskSnapshotAvailable,status,publishedAt,dueAt?,settings?,createdBy,createdAt,updatedAt,taskPublisher,task}`。

- `status: ACTIVE | CLOSED | RECALLED`，仅输出真实保存的合法标量状态，不补造 ACTIVE 或扩展为 nullable；异常状态与列表过滤合同见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。
- `taskPublisher: {id,name?} | null` 来自模板发布者，安全字段仅 id/name。
- `task={title,description,knowledgeModule,courseLabel?,difficulty?,rubric?,status}`；教学字段只取结构有效的实际快照，正常响应的 `taskSnapshotAvailable:boolean` 为 true。异常读取及写入拒绝见 API Owner。`status` 仍为当前模板资产状态；公开投影不包含原始快照、aiContextRefs 或资料路径。
- 公开 `settings` 仅白名单投影 `allowLate`，保留原有缺省/可选语义；Mongo Mixed 中残留的 maxAttempts、旧策略或其它内部字段均不展开透出。发布、更新返回、教师列表/详情及学生详情使用同一公开边界；GET 不回填、不清理、不更新时间戳。
- 发布候选的 Query / response 与 Task 模板 family 共用，见[发布候选模板](#发布候选模板)。

### Submission request / response family

来源：[CreateSubmissionDto](../../backend/src/modules/learning-tasks/dto/create-submission.dto.ts)、[UpdateSubmissionDto](../../backend/src/modules/learning-tasks/dto/update-submission.dto.ts)、[SubmissionResponseDto](../../backend/src/modules/learning-tasks/dto/submission-response.dto.ts)、[SubmissionDetailResponseDto](../../backend/src/modules/learning-tasks/dto/submission-detail-response.dto.ts)、[ClassroomTasksService](../../backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts)。

- 课堂任务提交使用 `CreateSubmissionDto`：`content={codeText:string,language:string,submissionNote?:string}`，nested validation；可选 `meta={aiUsageDeclaration?:string}`。创建与修改共用的 codeText/language 使用 `IsString + IsNotEmpty`，必须为非空字符串，空字符串 "" 在 DTO 阶段返回 400；保留原文、不 trim，不改变纯空白字符串的既有口径，language 无枚举白名单。submissionNote 可省略/空字符串，null、非字符串或超过 20,000 Unicode 码点返回 400；通过 ValidateIf 跳过 undefined、IsString 与 Unicode Matches 校验，保留原文/换行/缩进，省略时完整 content 响应统一为 ""。限制是产品字段长度，不是模型 Token 预算。多源码保持 `===== FILE: 相对路径 =====` 文本约定，仍要求源码，不提供纯文字提交类型。请求不接受客户端指定 submission 归属或 attemptNo。
- `SubmissionResponseDto`：`{id,taskId,classroomTaskId,studentId,attemptNo,content,meta?,status,aiFeedbackStatus,submittedAt,isLate,lateBySeconds,createdAt,updatedAt}`；`content={codeText,language,submissionNote}`，submissionNote 始终为字符串；meta 只白名单投影 aiUsageDeclaration。`submittedAt` 表示提交时刻，`isLate` 是迟交标志，`lateBySeconds` 是迟交秒数。
- `SubmissionDetailResponseDto`：`{id,taskId,classroomTaskId,taskSnapshotAvailable,studentId,studentName,taskTitle,language,content,meta?,submittedAt,attemptNo,isLate,lateBySeconds,aiFeedbackStatus,aiReview}`；`studentName/taskTitle/language/submittedAt/attemptNo` 可为 null，`content={language:string|null,codeText:string|null,submissionNote:string}`；taskTitle 只取结构有效的实例快照标题，快照缺失或无效时为 null，taskSnapshotAvailable=false。已保存正文、语言、说明、声明及反馈仍按原权限读取。meta 仅返回已有 aiUsageDeclaration，不暴露任意内部字段、不从说明派生声明；GET 不补写快照或取当前模板替代。
- 上述两个 DTO 的 `classroomTaskId` 均为必需 string，来自已验证的保存值，不输出 undefined/null 或从请求参数补造；关联异常不再作为正常详情返回，列表排除无关联及非法类型记录。权限与关联错误语义见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
- `UpdateSubmissionDto`：必填 `expectedRevision` 为非负安全整数（无字符串转换；缺失/null/负数/小数拒绝）；必填非 null object `content`，完整替换 `language/codeText/submissionNote` 并复用创建文本规则，说明省略为 ""，原文不 trim。拒绝所有归属、时间、attempt、revision、评阅状态和 meta 系统字段。PATCH 成功返回权威 `SubmissionDetailResponseDto`。
- 上述创建/提交响应与详情共同提供 `contentRevision:number|null`、`lastEditedAt:Date|null`、`lastEditIsLate:boolean|null`、`reviewStartedAt:Date|null` 和 `editing={canEdit:boolean,reason:string|null,message:string|null}`。新建 revision=0、修改时间对为 null；仅实际 number 类型的非负安全整数是有效版本，缺失、null 或非法值均投影 null，并令 editing.canEdit=false、editing.reason=INVALID_STATE。合法课堂关联下已获授权的作品内容、说明、声明及反馈仍可读取，GET 不回填版本、不固定评阅或改写时间戳。非法时间/状态同样 fail-closed；投影 null 不代表可修改。
- 历史补录保存的 contentRevision=0 表示现存作品纳入当前版本控制的基线，不证明历史上从未修改，也不恢复真实编辑次数；不补造编辑时间、评阅固定或旧 Feedback/Job 的版本归属。
- `editing.reason`：可编辑时 null；稳定阻断值为 `INVALID_STATE | REVIEW_STARTED | NOT_OWNER | CLASSROOM_TASK_REQUIRED | CLASSROOM_TASK_UNAVAILABLE | TASK_MISMATCH | SNAPSHOT_MISSING | ENROLLMENT_INACTIVE | CLASSROOM_UNAVAILABLE | CLASSROOM_ARCHIVED | CLASSROOM_TASK_CLOSED | DEADLINE_PASSED | UNAVAILABLE`。客户端仅在有效 revision 且明确 canEdit=true 时开入口，资格不等同于 AI 申请资格。
- `submittedAt/createdAt/isLate/lateBySeconds` 始终保留首次提交事实；`lastEditedAt/lastEditIsLate` 仅由实际内容保存成对更新，按保存时当前 dueAt/allowLate 判定。`updatedAt` 不是内容修改时间；`reviewStartedAt` 表示正式受理评阅，之后不自动清除，不表示 Feedback/Job 已创建。
- 版本/评阅状态冲突及反馈幂等 payload 不一致返回 409。正式 HTTP 沿用全局错误响应 `{statusCode,timestamp,path,message}`，不透传 Service 异常中的内部 code/reason；客户端按已知 message 并读取权威详情核对原因。拒绝和恢复流程见 Service Owner。
- `aiFeedbackStatus` 值域 `NOT_REQUESTED | PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`，无 job 显式返回 `NOT_REQUESTED`。首提与后续 attempt 在尚无手工 request 或其它既有评阅事实时均为 NOT_REQUESTED，不因提交自动进入评阅。
- 详情新增 `aiReview={provider,canRequest,requestBlockReason,failure,retryScheduled,nextRetryAt,inputCoverage,usage}`：
  - provider 为 `bailian | stub | null`；canRequest 仅表示当前用户符合 A1 申请资格且尚无 Job，允许时 requestBlockReason=null，否则为安全中文原因。该辅助资格不代替有效版本校验，客户端仍须结合 contentRevision，正式 POST 重新检查；授权及幂等合同见 API Owner。
  - failure 为 null 或 `{code,message}`；code 白名单为 `AI_CONTEXT_UNAVAILABLE | AI_CONTEXT_LIMIT_EXCEEDED | INPUT_BUDGET_EXCEEDED | OUTPUT_LIMIT_REACHED | PROVIDER_CONFIGURATION | RATE_LIMITED | UPSTREAM_UNAVAILABLE | INVALID_RESPONSE | TASK_INELIGIBLE | LEGACY_JOB_UNSUPPORTED | INTERNAL_ERROR`。message 为服务端安全中文，不返回 lastError、堆栈、上游原文或连接信息。输入超限文案为“作业已保存，完整内容超过 AI 输入限额，本次未生成 AI 反馈。”；次数耗尽保留最后原因。
  - retryScheduled 仅新版 FAILED、尚有次数、有 notBefore 且当前 Worker 启用时为 true，nextRetryAt 此时为 ISO 时间，其余 false/null；计划不保证已开始或成功。
  - inputCoverage 为 `FULL | NOT_SENT | UNKNOWN`。FULL 仅本版 Bailian 成功，表示完整材料进入请求，不认证运行或掌握；确定无真实请求及 stub 为 NOT_SENT；旧结果及已预留但覆盖无法确认的未成功结果为 UNKNOWN。
  - usage 为 `{reservedRequests,reportedRequests,unreportedRequests,promptTokens,inputTextTokens,cachedInputTokens,uncachedInputTokens,completionTokens,outputTextTokens,reasoningTokens,answerTokens,totalTokens}`，12 个字段均必有，类型为 number|null。reservedRequests 是持久化预留数，不是准确送达数；reportedRequests 是获得合法主 usage 的记录数，缺少可选细分仍计入实报；unreportedRequests 为两者之差，表示缺少合法主 usage 的预留数，不等同于失败请求数、未送达数或缺少思考明细的请求数。
  - 四项实报细分对应供应商 `usage.prompt_tokens_details.text_tokens` → inputTextTokens、`prompt_tokens_details.cached_tokens` → cachedInputTokens、`completion_tokens_details.text_tokens` → outputTextTokens、`completion_tokens_details.reasoning_tokens` → reasoningTokens。明细分别要求非负安全整数，0 有效；前两项不得超过 promptTokens，后两项不得超过 completionTokens。缺失、null、类型错误、负数、小数、非有限数、超安全整数或超过所属总量，仅使对应项为 null，不丢弃合法主 usage 或其他合法明细；主三项沿用原校验，主 usage 无效仍整体为 null。
  - answerTokens 为逐请求 `outputTextTokens - reasoningTokens`，只在两项明确合法且前者不小于后者时可得；缺少 text_tokens 不以 completionTokens 替代，负差不归零、不取绝对值。它表示模型原始最终回答的非思考文本用量，包含返回 JSON 结构等内容，不是页面反馈文字单独消耗的 Token；反馈解析失败也可能已产生该用量。uncachedInputTokens 为逐请求 `promptTokens - cachedInputTokens`；这两项仅在后端摘要派生，不持久化。
  - 汇总范围是同一 Job 的全部预留请求，包含失败尝试。主三项仍要求全部请求已报告才返回合计，否则三个合计均 null。四项实报细分各自独立判断：全部请求对应字段均有效、已知才求和，任一未知仅使该项合计为 null。answerTokens、uncachedInputTokens 必须先逐请求校验并计算再求和，任一请求缺依据或关系非法，对应合计为 null，不对跨请求汇总值直接相减；新增合计超安全整数范围也为 null。
  - completionTokens 已包含思考，totalTokens 仍为输入加输出，不再叠加 reasoningTokens；outputTextTokens 是包含思考的文本输出分类。文本与缓存属于不同分类，不能将所有展示条目相加。
  - 无 Job、当前预算版本零请求及 stub 等既有确定零用量情形，所有合计和未报告请求数均为 0；历史预算未知时所有用量字段均为 null。当前版本旧记录缺少细分时，已有主计数与请求计数保持，缺失细分及依赖它的派生项为 null，其他完整合计仍可用。budgetVersion 保持 1，不迁移、不回填，也不读取诊断文件补历史。
  - 只暴露摘要，不含执行记录、prompt、源码副本、原始响应、密钥或请求头；客户端不可写预算版本、用量、覆盖、次数和失败来源。轻量列表不含 aiReview.
- `QueryClassroomTaskSubmissionsDto` 只有分页校验，默认 `page=1,limit=20`；返回 `{items,total,page,limit}`。item 为 `{id,taskId,classroomTaskId,student,attemptNo,submittedAt,isLate,lateBySeconds,status,aiFeedbackStatus,feedbackCount}`。
- 列表 `student={id,email,roles,status,name,studentNo,employeeNo}`，后三项文本可为 null。`attemptNo` 是该学生在当前 classroomTaskId 下的独立序号，从 1 递增。
- 列表 `feedbackCount` 为该 submission 的全来源 Feedback 总条数，没有反馈时为 0；它不是 AI-only 的 `feedbackSummary.totalItems`。
- 详情允许公开 `content.codeText`；课堂任务提交列表不返回 codeText；以上投影均不返回 passwordHash。冷却错误携带公开重试提示 `retryAfterMs/retryAfterSeconds`；触发条件及错误码见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。

### My-task-detail / AI feedback summary family

[QueryMyTaskDetailDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-my-task-detail.dto.ts)：可选 `includeFeedbackItems` 用 `IsBooleanString`，默认 false，仅 `"true"` 启用；`feedbackLimit?` 经 Type(Number)，整数 `1..20`，默认 5。

顶层返回 `{classroom,classroomTask,task,me,submissions,latest,completionStatus,participationStatus}`：

- `classroom={id,name,courseId,status}`；`classroomTask={id,classroomId,taskId,taskSnapshotAvailable,status,publishedAt,dueAt?,settings?}`（settings 使用上述 allowLate 白名单）；`task={id,title,description,knowledgeModule,courseLabel?,difficulty?,rubric?,status}`；`me={studentId}`。
- `submissions[]`：`{id,attemptNo,createdAt,aiFeedbackStatus,feedbackSummary,feedbackItems?}`。
- `latest`：`{submissionId,attemptNo,aiFeedbackStatus,feedbackSummary,feedbackItems?} | null`；未提交时为 null。
- `feedbackSummary={totalItems,topTags,severityBreakdown}`，只统计 AI 反馈；`topTags` 为 `{tag,count}[]`；`severityBreakdown={INFO,WARN,ERROR}`。空摘要为总量 0、tags 空数组、三类严重程度计数 0。
- `feedbackItems?` 仅开启预览时返回，元素 `{source,type,severity,message,suggestion?,tags?}`，空时为 `[]`；预览上限不改变完成态。公开完成态见[学生状态 family](#student-completion--participation-public-state)。

## Query DTO / Public Response（读取接口）

本节按报表 / Analytics family 组织，保留既有章节锚点供 Service Map 定位。窗口合法值以各 Query DTO 为准；支持 `all` 的报表中，它表示当前资源口径下无时间下界，不是固定 90/180 天。前端主选项见 Route Map，不与后端兼容集合混用。

### 课程总览

来源：[QueryCourseOverviewDto](../../backend/src/modules/courses/dto/query-course-overview.dto.ts)、[CourseOverviewService](../../backend/src/modules/courses/services/course-overview.service.ts)。

- `window?: all | 7d`，`IsIn`，默认 all。
- `sort?: studentsCount | submissionRate | overallSubmissionCoverage | aiSuccessRate | pendingJobs | failedJobs`，默认 aiSuccessRate；`order?: asc | desc`，默认 desc。
- 分页校验，默认 `page=1,limit=20`。
- item 的 `submissionRate` 保持“至少提交过一次的学生覆盖率”：`distinctStudentsSubmitted / studentsCount`，零分母为 0。
- `overallSubmissionCoverage` 是全部已发布课堂任务整体提交覆盖度：`sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`，零分母为 0；不能与 submissionRate 互换。
- `ai.aiSuccessRate` 在 `jobsTotal=0` 时为 null，否则为 `succeededJobs / jobsTotal`。上述是公开字段定义；查询与聚合实现仅见 [Service Card 08C](./handoff-backend-service-map.md#service-card-08c)。

### Learning trajectory

来源：[QueryLearningTrajectoryDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-learning-trajectory.dto.ts)、[ClassroomTasksService](../../backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts)。

- `window?: all | 7d`，默认 all；分页校验，默认 `page=1,limit=20`。
- `sort?: latestAttemptAt | attemptsCount | errorRate | notSubmitted`，默认 latestAttemptAt；`order?: asc | desc`，默认 desc。
- `includeAttempts? / includeTagDetails?` 用 IsBooleanString，均默认 true；显式传值时仅 `"true"` 启用，`"1"` 虽通过布尔字符串校验但不会启用。
- 返回 `{classroomId,classroomTaskId,window,generatedAt,page,limit,total,items}`。
- item：`{studentId,student,attemptsCount,latestAttemptAt,latestAiFeedbackStatus,trend,attempts}`；`student={id,name,studentNo,email}`，文本可为 null。无提交学生也有 item，次数 0、latest 时间/AI 状态为 null。
- `trend={errorCountFirst,errorCountLatest,errorDelta,topTagsFirst,topTagsLatest}`；tags 是 `{tag,count}[]`。
- `attempts[]`：`{submissionId,attemptNo,createdAt,isLate,lateBySeconds,aiFeedbackStatus,feedbackCount,feedbackSummary}`；关闭 includeAttempts 时返回 `[]`。`feedbackCount` 是全来源总量；`feedbackSummary` 复用上文 AI-only family，关闭 tag details 时摘要 tags 为空数组。
- 不返回 passwordHash 或提交正文。页内排序与反馈聚合见 [Service Card 08E](./handoff-backend-service-map.md#service-card-08efeature-learning-trajectory-z4)。

### Review pack

来源：[QueryClassReviewPackDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts)、[ClassReviewPackService](../../backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts)。

- `window?: all | 7d`，默认 all；`topK?` 经 Type(Number)，整数 1..30，默认 10；`examplesPerTag?` 同样转换，整数 1..5，默认 2。
- 顶层 `{classroomId,classroomTaskId,window,generatedAt,overview,commonIssues,examples,studentTiers}`。
- `overview` 包含 `studentsCount/submittedStudentsCount/submissionRate/attemptsDistribution/lateSubmissionsCount/lateStudentsCount` 与 `ai={jobsTotal,successRate,errorsTop}`。
- `commonIssues` 包含 `topTags/topTypes/topSeverities`；topTags 是按标签计数，多标签反馈可贡献多个标签。`examples` 是按 feedbackId 去重的典型样例池，元素 `{feedbackId,submissionId,attemptNo,severity,type,message,suggestion,source,primaryTag,matchedTags,tags}`。
- `studentTiers={good,watch,notSubmitted}`，三组为当前范围的完整 ACTIVE 学生分层，不是预览切片。每项 `{studentId,studentName,studentNo}`；good/watch 另有 `attemptsCount/latestErrorCount`。姓名缺失回落 `未知学生`。
- good 表示最新提交 AI job 成功且 AI ERROR 数为 0；watch 为其余已提交学生；notSubmitted 为窗口内无提交。`latestErrorCount` 仅指最新提交的 AI ERROR 数量。内部取样与分层步骤见 [Service Card 08F](./handoff-backend-service-map.md#service-card-08f)。
- examples 不返回 `codeText/prompt/apiKey`；响应无 `actionItems/teacherScript`。

### AI Metrics

来源：[QueryAiMetricsDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-ai-metrics.dto.ts)、[AiMetricsService](../../backend/src/modules/classrooms/classroom-tasks/services/ai-metrics.service.ts)、[公开聚合类型](../../backend/src/modules/classrooms/classroom-tasks/services/ai-feedback-metrics-aggregator.service.ts)。

| Query | validation / default / 解析 |
| --- | --- |
| `window?` | `IsIn`：`1h \| 24h \| 7d`；默认 24h，不支持 all。 |
| `includeTags?` | `IsBooleanString`；省略时 true；显式值仅 `"true"` 启用，`"false"/"0"/"1"` 均关闭。不得按常见布尔习惯把 `"1"` 文档化为 true。 |

顶层为 `{classroomId,classroomTaskId,generatedAt,window,summary,errors,feedback}`：

- `summary={jobs,successRate,avgAttempts,avgLatencyMs}`；`jobs={total,pending,running,succeeded,failed,dead}`，均为数量。
- `successRate/avgAttempts` 无样本时为 0；`avgLatencyMs: number | null`，**当前实现固定返回 null**，不是 0。
- `errors` 为 `{code:string,count:number}[]`；只暴露归类后的 code/count，不返回原始 Provider 响应。
- `feedback={avgItemsPerSubmission,totalItems,topTags}`，为 AI 反馈统计；无反馈时平均数/总量为 0。`topTags` 为最多 5 项 `{tag,count}[]`，省略 includeTags 时正常返回；关闭或无数据时为 `[]`，不是缺省字段。
- 不返回代码、prompt、API key 或用户凭据。指标算法及内部 latency 限制原因仅见 [Service Card 11](./handoff-backend-service-map.md#service-card-11)。

### Weekly report

来源：[QueryClassroomWeeklyReportDto](../../backend/src/modules/classrooms/dto/query-classroom-weekly-report.dto.ts)、[TeacherClassroomWeeklyReportService](../../backend/src/modules/classrooms/services/teacher-classroom-weekly-report.service.ts)。

- `window?: all | 7d | 30d`，IsIn，默认 all。
- `includeRiskStudentIds?` 用 IsBooleanString，控制风险学生样本 id 暴露。
- 返回 `{classroom,window,generatedAt,progress,atRisk,aiHealth,topTags}`；`classroom={id,name,courseId,status}`。
- `classroom.status` 直接返回实际保存且已验证的合法 `ACTIVE | ARCHIVED`，不对缺失或 null 补默认值；异常状态及错误优先级见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。
- `progress` 为 `{studentsCount,publishedClassroomTasks,dueClassroomTasks,distinctStudentsSubmitted,submissionRate,lateSubmissionsCount,lateStudentsCount}`。
- `atRisk={notSubmittedStudentsCount,sampleStudentIds}`；未开启 id 暴露时 sampleStudentIds 为 `[]`。
- `aiHealth={jobs,successRate,rateLimitRatio,timeoutRatio,errors}`；jobs/errors 复用 AI Metrics 中的数量与 code/count 形状，三个比率零分母为 0。风险与聚合口径见 [Service Card 08B](./handoff-backend-service-map.md#service-card-08b)。

### Process Assessment

来源：[QueryProcessAssessmentDto](../../backend/src/modules/classrooms/dto/query-process-assessment.dto.ts)、[ProcessAssessmentService](../../backend/src/modules/classrooms/services/process-assessment.service.ts)。

| Query | validation / default |
| --- | --- |
| `window?` | `IsIn`：仅 `7d \| 30d \| all`；省略时默认 all；**24h 不合法**。 |
| `page? / limit?` | 分页校验；默认 `1 / 50`。 |
| `sort?` | `score \| submissionsCount \| submittedTasksCount \| aiRequestedCount \| riskLevel`，默认 score。 |
| `order?` | `asc \| desc`，默认 desc。 |
| `excludedTaskIds?` | 接受逗号分隔或 repeated query；拆分、trim、去空后形成字符串数组，`IsArray + IsMongoId(each)`。每项指课堂任务实例 id。 |

JSON 与 CSV 复用同一 Query DTO，包括 window、排除项与分页口径。返回 JSON 为 `{classroomId,window,generatedAt,page,limit,total,rubric,items}`。

| Item 字段 family | 稳定形状 / 语义 |
| --- | --- |
| 学生 | `studentId,studentName,studentNo`；姓名缺失/空白为 `未知学生`，学号缺失/空白为 null。 |
| 提交与任务 | `submittedTasksCount,publishedTasksCount,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount`。 |
| AI | `aiRequestedCount,aiSucceededCount` 为请求/成功总次数；`aiRequestedTasksCount,aiSucceededTasksCount` 为任务数量，不能互换。 |
| 反馈 | `avgFeedbackItems,avgWarnItems,avgErrorItems,topTags:{tag,count}[]`；平均项为任务维度 AI 反馈代理，INFO 只进入 avgFeedbackItems，WARN / ERROR 分别进入相应字段；代表提交的选择见 Service。 |
| 评价 | `score:number,riskLevel:LOW \| MEDIUM \| HIGH`；零提交或有效任务为空时 score=0，排除全部任务时任务相关数量/统计归零，学生仍返回。 |

`rubric` 固定公开权重：`submittedTasksRate=0.45, submissionsCount=0.15, aiRequestQualityProxy=0.2, codeQualityProxy=0.2`，依次对应任务覆盖、迭代质量、AI 使用质量和代码质量代理。具体评分、risk、排除项重算与反馈选择仅见 [Service Card 08G](./handoff-backend-service-map.md#service-card-08g)。

CSV 是 UTF-8 BOM 开头的文本，列顺序为：

```text
studentName,studentNo,studentId,score,riskLevel,submittedTasksRate,submissionsCount,iteratedTasksCount,lateSubmissionsCount,lateTasksCount,aiRequestedCount,aiSucceededCount,aiRequestedTasksCount,aiSucceededTasksCount,avgWarnItems,avgErrorItems,topTags
```

CSV 空学号为空单元格，topTags 为 `tag:count` 以分号连接；JSON/CSV 均不返回密码、提交代码或 Provider 私有内容。导出媒体类型与高层行为见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。

### Classroom Export Snapshot

来源：[QueryClassroomExportSnapshotDto](../../backend/src/modules/classrooms/dto/query-classroom-export-snapshot.dto.ts)、[ClassroomExportSnapshotService](../../backend/src/modules/classrooms/services/classroom-export-snapshot.service.ts)。

| Query | validation / default |
| --- | --- |
| `window?` | `IsIn`：仅精确 `7d \| 30d`，省略时默认 30d；显式传入 term、24h、all 等其他值均不合法。 |
| `limitStudents? / limitAssessment?` | `Type(Number) + IsInt`，范围 1..1000，分别默认 200。 |
| `includePerTask?` | `IsBooleanString`；默认 true，显式值仅 `"true"` 启用；`"1"` 不启用。 |

稳定顶层：`{meta,course,classroom,students,classroomTasks,summary,statsByClassroomTask,statsByStudent,processAssessment}`。

- `meta={generatedAt,window,effectiveWindow,notes:string[]}`；window 与 effectiveWindow 相同，省略窗口时均为 30d。notes 保留逐任务省略与截断说明，不再包含 term 映射说明。
- `course={id,code,name,term,status}`；`classroom={id,name,courseId,status}`；`students={total,exported}`，total 是正式学生总数，exported 是导出的 statsByStudent 项数。
- `classroomTasks[]={classroomTaskId,taskId,publishedAt,dueAt,allowLate}`，时间可为 null；allowLate 是 boolean。
- `summary={progress,aiHealth,commonIssues,late}`；progress/aiHealth 复用 Weekly report family，`late={lateSubmissionsCount,lateStudentsCount}`。
- `statsByClassroomTask[]` 包含 `classroomTaskId,taskId,submissions:{total,lateTotal,distinctStudents},ai:{jobsTotal,succeeded,failed,dead,pending,running,errorsTop},commonIssues`。
- `statsByStudent[]={studentId,submittedTasksCount,submissionsCount,lateSubmissionsCount,aiRequestedCount,aiSucceededCount,topTags,riskLevel,score}`；`processAssessment={rubric,items}` 复用 Process Assessment family。
- 两个 limit 分别约束 statsByStudent 和 processAssessment.items；发生截断时 notes 写明对应区块、original 与 exported 数量。关闭 includePerTask 时 `statsByClassroomTask=[]`，notes 明示 `perTask omitted by includePerTask=false`，不是省略顶层字段。
- 不导出密码、token、学生提交 codeText、prompt 或 API key。组合、排序、截断执行策略仅见 [Service Card 08H](./handoff-backend-service-map.md#service-card-08h)。

### AI Learning Analytics

来源：[QueryAiLearningAnalyticsDto / QueryAiLearningAnalyticsStudentsDto](../../backend/src/modules/classrooms/dto/query-ai-learning-analytics.dto.ts)、[公开枚举与方法学常量](../../backend/src/modules/classrooms/types/ai-learning-analytics.types.ts)、[AiLearningAnalyticsService 返回投影](../../backend/src/modules/classrooms/services/ai-learning-analytics.service.ts)。

#### Analytics query family

- 基础 Query：`window?: all | 7d | 30d`，IsIn，默认 all；不支持 term。`excludedTaskIds?` 接受逗号分隔或 repeated query，拆分/trim/去空/去重为数组，再 `IsArray + IsMongoId(each)`；返回 context 中使用规范化 id。
- Students Query 继承基础 Query，增加分页校验，默认 `page=1,limit=20`；`q?` 为字符串，trim 后空白视为未传，最长 100；`overallOutcome? / engagementStatus?` 使用下述枚举。
- 无任意字段 sort 参数；搜索范围与 AND 组合见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。window 的日期对象是有效课堂任务的 publishedAt，任务点仍可引用该任务完整提交范围。

#### Analytics context / methodology

| Family | 稳定字段 |
| --- | --- |
| `context` | `classroomId,classroomName,courseId,courseName,courseCode,courseTerm,generatedAt,window,effectiveTaskCount,excludedTaskIds`。课程三项文本可为 null，generatedAt 为时间字符串。 |
| `methodology` | `scope=AI_FEEDBACK_INTERVENTION_V1`；`version=AI_FEEDBACK_INTERVENTION_V1_2`；`sampleUnit=STUDENT_CLASSROOM_TASK`；`qualityProxy=ERROR_PLUS_HALF_WARN`；`disclaimer` 为下述公开文本。 |
| 学生摘要 | `{studentId,studentName,studentNo}`，姓名缺失/空白为 `未知学生`，学号缺失/空白为 null。 |

disclaimer：本分析仅反映 EduForge AI 反馈介入后的作品更新与反馈条目负荷变化，不代表 AI 对学习成绩或能力提升的因果贡献。

#### Analytics response families

| Family | Shape |
| --- | --- |
| 总览 | `{context,methodology,summary,taskTrends}`，任务趋势包含零提交任务。 |
| 学生列表 | `{context,methodology,page,limit,total,activeStudentsTotal,filters,items}`。 |
| 学生详情 | `{context,methodology,student,summary,taskPoints}`；每个有效课堂任务都有 task point。 |

`activeStudentsTotal` 是全部当前 ACTIVE 学生数，不受搜索筛选影响；`total` 是组合筛选结果数。`filters={q,overallOutcome,engagementStatus}` 回显规范化值，未传项为 null；无筛选时两个总数相等。

计数 family 的精确命名如下，全部为 number，空样本计数为 0：

- 总览 summary：`activeStudentsCount`；`submittedStudentTaskCount,aiRequestedStudentTaskCount,aiDeliveredStudentTaskCount,postFeedbackResubmittedStudentTaskCount,postFeedbackRevisedStudentTaskCount,postFeedbackCodeChangedStudentTaskCount,qualityComparableStudentTaskCount,improvedStudentTaskCount,remainedCleanStudentTaskCount,unchangedWithIssuesStudentTaskCount,regressedStudentTaskCount`。
- taskTrend：`classroomTaskId,taskId,taskTitle,publishedAt`；`submittedStudentCount,aiRequestedStudentCount,aiDeliveredStudentCount,postFeedbackResubmittedStudentCount,postFeedbackRevisedStudentCount,postFeedbackCodeChangedStudentCount,qualityComparableStudentCount,improvedStudentCount,remainedCleanStudentCount,unchangedWithIssuesStudentCount,regressedStudentCount`。
- 学生 item 与详情 summary 共用 metrics：`submittedTasksCount,aiRequestedTasksCount,aiDeliveredTasksCount,postFeedbackResubmittedTasksCount,postFeedbackRevisedTasksCount,postFeedbackCodeChangedTasksCount,qualityComparableTasksCount,improvedTasksCount,remainedCleanTasksCount,unchangedWithIssuesTasksCount,regressedTasksCount`，另含 `overallOutcome,engagementStatus`；列表 item 还包含学生摘要。

总览 summary 与 taskTrend 共有 rate：`aiTaskCoverageRate,postFeedbackResubmissionRate,postFeedbackRevisionRate,postFeedbackCodeChangeRate,qualityComparableRate,improvedRate,remainedCleanRate,unchangedWithIssuesRate,regressedRate`；summary 另有 `aiStudentCoverageRate,aiDeliveryRate`，学生 metrics 同样提供 `postFeedbackRevisionRate`。所有 rate 均为 number|null，自身零分母为 null，分子0且分母大于0为真实0。summary、taskTrend 和学生 metrics 均返回 `averageIssueLoadBefore,averageIssueLoadAfter,averageIssueLoadDelta:number|null`，无可比样本时为 null；后端不提前舍入比率或均值。

summary、taskTrend 和学生 metrics 均有 `evidenceSummary={sourceUncertainComparableCount,modelChangedComparableCount,simulatedExcludedSampleCount}`，三个非负计数分别提示来源/模型不完整的可比样本、已知模型不同的可比样本及存在被排除模拟评阅的样本；可重叠，不可相加作为分母。

`taskPoint`：`{classroomTaskId,taskId,taskTitle,publishedAt,attemptsCount,aiRequested,aiDelivered,postFeedbackResubmitted,postFeedbackRevised,postFeedbackCodeChanged,qualityComparable,issueLoadBefore,issueLoadAfter,issueLoadDelta,detailedOutcome,baselineReview,comparisonReview,latestRevision,hasNewerUncomparedRevision,comparisonWarnings}`。未提交点次数为0、上述六个行为布尔值为false；不可比较点三个 issueLoad 为null、detailedOutcome 为 NOT_COMPARABLE。可比较点 issueLoad 是 number，delta 正值表达反馈条目负荷下降，不等同代码正确性或能力变化。

- `aiRequested` 表示有请求 Job；`aiDelivered` 表示有非模拟可用反馈，不能把成功空反馈算作零负荷。`postFeedbackResubmitted` 只指反馈后新增提交，`postFeedbackRevised` 包括可确认的反馈后编辑；两者不改变 attemptsCount。详细时间与选择算法见 Service Owner。
- `baselineReview/comparisonReview/latestRevision` 均为 object|null，共同形状为 `{submissionId:string,attemptNo:number|null,contentRevision:number|null,submittedAt:string|null,lastEditedAt:string|null,contentVersionAt:string|null,feedbackCompletedAt:string|null,provider:bailian|stub|null,model:string|null}`；时间为 ISO，未知项为null。latestRevision 包括未申请、处理中、失败、空反馈及模拟版本，不限成功评阅；其中无完成事实不伪造完成时间。contentRevision 缺失或非法时投影 null、contentVersionAt 未知；版本有效性及历史补录语义见 [Submission 版本字段说明](#submission-request--response-family)，内容时间算法见 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i)。
- `hasNewerUncomparedRevision:boolean|null` 表示相对于比较终点（无终点则基线）是否存在较新未比较版本，独立于全局最新版本选择；latestRevision=null 可以与此标记 true 并存。标记 null 可能表示尚无比较参考，也可能表示时间信息不足，不能一律解释为最新版本时序未知或确定false；完整判定见 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i)。
- `comparisonWarnings` 为稳定原因数组：`EMPTY_FEEDBACK | SIMULATED_REVIEW_EXCLUDED | SOURCE_UNKNOWN | MODEL_UNKNOWN | MODEL_CHANGED | TIME_UNKNOWN`。`SOURCE_UNKNOWN/MODEL_UNKNOWN` 仅检查实际存在的已选 baselineReview/comparisonReview；无比较终点时仍检查已有基线，不为 null 端点或非端点历史记录制造警告，来源已知不代表模型已知。`MODEL_CHANGED` 仍比较两端已知模型；`EMPTY_FEEDBACK/SIMULATED_REVIEW_EXCLUDED/TIME_UNKNOWN` 保留既有样本范围。来源缺失可作已有记录对照，但不能认证为真实 Provider；模型不同允许对照并提示，相同名称也不证明 Prompt 或内部版本相同。

#### Analytics public enums

| 字段 | 值域 |
| --- | --- |
| `detailedOutcome` | `IMPROVED \| REMAINED_CLEAN \| UNCHANGED_WITH_ISSUES \| REGRESSED \| NOT_COMPARABLE` |
| `overallOutcome` | `INSUFFICIENT_DATA \| IMPROVED_OVERALL \| NO_NET_CHANGE \| REGRESSED_OVERALL` |
| `engagementStatus` | `NO_SUBMISSION \| SUBMITTED_WITHOUT_AI_REQUEST \| AI_REQUESTED_WITHOUT_DELIVERY \| AI_DELIVERED_WITHOUT_REVISION \| REVISED_WITHOUT_COMPARABLE \| QUALITY_COMPARABLE` |

- REMAINED_CLEAN 表示可比且前后均无 ERROR/WARN，UNCHANGED_WITH_ISSUES 表示非零反馈条目负荷持平。其它结果标签为负荷下降、负荷上升和不可对照。
- overallOutcome 表达当前任务范围净结果；NO_NET_CHANGE 可能包含改善与恶化抵消，不能理解为时间序列趋势。无可比样本时 overallOutcome 为 INSUFFICIENT_DATA。
- engagementStatus 表示当前范围到达的最深互斥反馈阶段，以作品更新替代旧重提阶段，旧 `AI_DELIVERED_WITHOUT_RESUBMISSION/RESUBMITTED_WITHOUT_COMPARABLE` 不再是现行查询值；时序不足只表示尚无可确认更新，不能断言未修改。产品解释边界见 API；V1.2 基线/最新已评阅内容版本选择、半单位整数算法、比率分母及计算、搜索筛选分页执行顺序唯一由 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i) 维护。
- 以上投影不返回 codeText、submission 原文、prompt、原始 requests、Provider 原始响应、参考资料、API key、密码/hash 或内部半分字段；学生公开摘要不暴露 email 或完整 User。

## Learning Tasks

### Task template DTO / response family

来源：[CreateTaskDto](../../backend/src/modules/learning-tasks/dto/create-task.dto.ts)、[UpdateTaskDto](../../backend/src/modules/learning-tasks/dto/update-task.dto.ts)、[QueryTaskDto](../../backend/src/modules/learning-tasks/dto/query-task.dto.ts)、[TaskResponseDto](../../backend/src/modules/learning-tasks/dto/task-response.dto.ts)。

| DTO | 字段与校验 |
| --- | --- |
| `CreateTaskDto` | 必填字符串 `title/description/knowledgeModule`；可选 `difficulty`（写入值域见下方）、对象 `rubric:Record<string,unknown>`、`courseLabel`、`visibility` 与 `status:DRAFT \| PUBLISHED`；status 默认 DRAFT。 |
| `UpdateTaskDto` | 上述字段可选；status 的校验集合为 `DRAFT \| PUBLISHED \| ARCHIVED`，其编辑行为见 API；rubric 不静态约束内部 key。 |
| `QueryTaskDto` | 可选 `scope:mine \| shared \| all`，默认 mine，trim + lowercase，空白视为未传；可选 status、字符串 knowledgeModule、courseLabel、difficulty（见下方查询合同）；分页校验。 |

- Task 的创建、更新、模板列表及发布候选查询不接受 `stage`，严格白名单对旧参数返回 400；公开模板、课堂内容、学生详情及教师看板均不投影旧记录中的该字段。新 Task 和新快照不写入该字段；存量字段和旧索引通过[受控定向运维](./handoff-backend-config-matrix.md#taskstage-定向退役运维)处理。
- knowledgeModule 无枚举白名单。`courseLabel` 使用 `TASK_COURSE_LABELS` 单选白名单（如未分类、通用编程、Java 程序设计、数据结构、人工智能）；trim 后空白转 undefined。更新中显式传入空白 courseLabel 表示清空；不是 Course 外键。
- Task 的新写入值域由 CreateTaskDto / UpdateTaskDto 与 Schema 共同约束：字段缺失或空串 `""` 表示未设置，三个准确英文值 `easy/medium/hard` 表示标准档位。创建省略不设置默认档位，PATCH 省略保留原值，显式空串清空；仅 undefined 跳过字段校验，null、空白、未知值、中文标签、大小写或首尾空格变体、数组、对象及数字均拒绝，不做值转换。UI 选项与安全显示约定由 [Frontend API Map](./handoff-frontend-api-map.md#33-teacher-任务--提交--反馈) 维护。
- 难度查询合同：`QueryTaskDto` 与 `QueryPublishableTaskTemplateDto` 的可选 `difficulty` 仅接受准确单值 `easy/medium/hard`；省略表示不限制。显式空串、空白、未知值、大小写变体或数组均返回 400，不 trim、不转大小写、不推断别名。写入允许空串不代表查询也允许空串。
- 请求 `visibility: PRIVATE | SHARED` 保持 trim + uppercase、空白视为未传，创建默认 PRIVATE；请求规范化不适用于存储值校验。成功响应仍为合法枚举，不补 SHARED 或其他默认值；存量异常的读取、授权及写前拒绝边界见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
- `courseLabel=未分类` 查询兼容匹配字段缺省/空值。scope 的可见性含义及已退役查询参数的错误口径见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
- `TaskResponseDto`：`{id,title,description,knowledgeModule,courseLabel?,visibility,difficulty?,rubric?,aiContextRefs?,status,createdBy,publisher,createdAt,updatedAt,publishedAt?}`。`publisher={id,name?}|null`，不返回完整 User。

### ZIP 资料引用配置

CreateTaskDto / UpdateTaskDto 通过继承 `TaskAiContextDto` 接受嵌套 `aiContextRefs?: Array<{archivePath:string;entryPaths:string[]}>`；Task Schema 持久化引用，教师模板列表/详情按既有可见性返回。创建省略为无依赖；PATCH 省略保留最终引用，`[]` 清空，`null` 不合法。非空引用必须选择条目；拒绝重复 archivePath、同包重复 entryPath、非法嵌套字段；保留配置顺序。大小上限由 [Config Matrix §7](./handoff-backend-config-matrix.md#7-zip-资料资源) 维护。

路径以 `/` 分隔且精确匹配，不 trim、改大小写或补前缀；archivePath 相对于 `.local` 且包含教材目录，entryPaths 为 ZIP 内完整文件路径。拒绝绝对路径、盘符/UNC、反斜杠、NUL、`.`/`..` 与空路径段。读取的文本扩展名为 `.md/.markdown/.txt/.json/.diff/.patch/.c/.h/.cc/.hh/.cpp/.hpp/.cxx/.hxx/.java/.py/.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts`，必须为严格 UTF-8，可带 BOM；不接受 NUL、无效 UTF-8 或二进制。未选中的 DOCX 不影响其它合法文本读取。

内部 TaskSnapshot 深复制引用和 entryPaths；课堂列表、详情及 my-task-detail 的 task 使用明确公开教学字段投影，不返回 aiContextRefs、资料正文或教师包路径。已有完整快照缺少此可选字段按无依赖；整个快照缺失时的只读/409 合同不变。Submission/Job 不保存参考资料正文。

以下成员已通过真实第14章 ZIP 只读核实。这是读取与配置示例，不表示已完整审查正式代码评阅所需依赖：

```json
{
  "aiContextRefs": [
    {
      "archivePath": "human-ai-programming/student/第14章_学生配套_C++_V0.5.1.zip",
      "entryPaths": ["chapter14_cpp/notes/AI任务委托卡.md"]
    },
    {
      "archivePath": "human-ai-programming/teacher/第14章_教师与编辑配套_三语言_V0.7.zip",
      "entryPaths": ["chapter14_teacher/teacher/教学与练习说明.md"]
    }
  ]
}
```

### 发布候选模板

来源：[QueryPublishableTaskTemplateDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-publishable-task-template.dto.ts)、[PublishableTaskTemplateResponseDto](../../backend/src/modules/classrooms/classroom-tasks/dto/publishable-task-template-response.dto.ts)。

- 可选 `courseLabel` 使用同一白名单；可选字符串 `knowledgeModule`；两者 trim 后空白转 undefined。
- 可选 `difficulty` 沿用 [Task 模板 family 的难度查询合同](#task-template-dto--response-family)。
- `onlyMine?` 经 Transform，支持布尔/数字 true/false/1/0，以及 trim + lowercase 后对应字符串；空白视为未传，再 IsBoolean。
- 分页校验同通用分页约定。
- 返回 `{items,total,page,limit}`；item 为 `{id,title,description,knowledgeModule,courseLabel?,visibility,difficulty?,status,createdBy,createdById,publisher,createdAt,updatedAt,publishedAt?}`；publisher 同上。候选资格与已发布排除见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)，课程分类排序见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)。

### Feedback DTO / response family

来源：[CreateFeedbackDto](../../backend/src/modules/learning-tasks/dto/create-feedback.dto.ts)、[UpdateFeedbackDto](../../backend/src/modules/learning-tasks/dto/update-feedback.dto.ts)、[FeedbackResponseDto](../../backend/src/modules/learning-tasks/dto/feedback-response.dto.ts)。

| 字段 | 公开合同 |
| --- | --- |
| `expectedRevision` | 仅创建必填非负安全整数，拒绝缺失/null/字符串/负数/小数；版本前置不进入 Feedback 业务内容，更新沿用原合同。 |
| `source` | 合法来源仅 AI / TEACHER；公开创建只允许 TEACHER（Equals），其余值及 null 为 400；更新不可写。 |
| `type` | 创建必填，更新可选；`SYNTAX \| STYLE \| DESIGN \| BUG \| PERFORMANCE \| SECURITY \| OTHER`。 |
| `severity` | 创建必填，更新可选；`INFO \| WARN \| ERROR`。 |
| `message` | 创建必填字符串；更新可选字符串且 MinLength(1)，空字符串不合法。 |
| `suggestion` | 可选字符串；更新允许空字符串。 |
| `tags` | 可选字符串数组，IsArray + IsString(each)；教师反馈另有统一词表归一化与白名单约束。 |
| `scoreHint` | 可选 number，IsNumber，0..100。 |

更新至少一个可写字段；Update DTO 对可选字段采用 `ValidateIf(value !== undefined)`，显式 null 不合法。更新白名单不含 `source/submissionId/createdBy/createdAt/updatedAt` 或任何任务、学生、课堂归属字段。

`FeedbackResponseDto`：`{id,submissionId,createdBy?,source,type,severity,message,suggestion?,tags?,scoreHint?,createdAt,updatedAt}`。`createdBy` 为可选作者 id，不是 User 对象；AI feedback 和缺作者历史 TEACHER feedback 可缺省，createdAt 是原创建时间。可选投影不表示允许通过更新认领或补写作者；创建作者、更新资格及历史读取边界见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。

## AI Feedback diagnostics / request family

来源：[RequestAiFeedbackDto](../../backend/src/modules/learning-tasks/dto/request-ai-feedback.dto.ts)、[QueryAiFeedbackJobsDto](../../backend/src/modules/learning-tasks/dto/query-ai-feedback-jobs.dto.ts)、[ProcessAiFeedbackJobsDto](../../backend/src/modules/learning-tasks/dto/process-ai-feedback-jobs.dto.ts)。

- `RequestAiFeedbackDto`：必填 `expectedRevision`，规则同 Submission PATCH；可选 `reason:string`，最长 200。已有 Job 也必须校验本次 expectedRevision，不自动补最新版。
- `QueryAiFeedbackJobsDto`：可选 `status:PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`；`limit` 转整数，1..100，默认 20。
- `ProcessAiFeedbackJobsDto`：可选 `batchSize`，整数 1..50，body 不声明数值字符串转换；省略时使用 Processor 的默认批次设置，配置入口见 [Config Matrix](./handoff-backend-config-matrix.md)。
- 诊断 Job item：`{id,submissionId,status,attempts,maxAttempts,notBefore,lockedAt,lockOwner,lastError?,createdAt,updatedAt}`；新版 attempts 为已持久化认领次数，maxAttempts 固定 3；历史诊断缺省 attempts=0、maxAttempts=3，notBefore/lockedAt/lockOwner/createdAt/updatedAt 可为 null。来源：[AiFeedbackJobService.listJobs](../../backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts)。
- 产品请求与 debug/ops 门禁分别见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks) 和 [API Debug / Ops](./handoff-backend-api-map.md#ai-feedback-debug--ops门禁接口)，不在数据 family 复制角色矩阵。
