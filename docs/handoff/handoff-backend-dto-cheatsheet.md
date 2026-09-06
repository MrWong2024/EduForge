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
- `ClassroomResponseDto`：`{id,courseId,course?,name,teacherId,joinCode,status,studentIds?,createdAt,updatedAt}`。只读 `course` 是 `{id,code?,name?,term?,courseLabel?,status?}`；关联缺失可省略，`courseId` 保留。`studentIds` 是 legacy 输出，成员权威边界见 [API Classrooms](./handoff-backend-api-map.md#classrooms)。
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
- `tasks[]`：`{classroomTaskId,classroomTaskStatus,taskId,taskPublisher,taskTemplateStatus,title,stage,knowledgeModule,publishedAt,dueAt,submissionsCount,distinctStudentsSubmitted,lateSubmissionsCount,lateDistinctStudentsCount,aiFeedback,topTags}`。
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
| `ACTIVE` | false | true / true | null |
| `CLASSROOM_NOT_ACTIVE` | true | false / false | 班级已归档或不可参与，仅可查看历史提交与反馈。 |
| `CLASSROOM_TASK_NOT_ACTIVE` | true | false / false | 课堂任务已关闭或不可参与，仅可查看历史提交与反馈。 |

这些值是状态层展示信号；动作授权边界、原因优先级和模板兼容行为见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。

## Classroom Tasks（Classrooms 子资源）

### ClassroomTask DTO / response family

来源：[CreateClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/create-classroom-task.dto.ts)、[UpdateClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task.dto.ts)、[UpdateClassroomTaskStatusDto](../../backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task-status.dto.ts)、[ClassroomTaskResponseDto](../../backend/src/modules/classrooms/classroom-tasks/dto/classroom-task-response.dto.ts)。

| DTO | 字段合同 |
| --- | --- |
| `CreateClassroomTaskDto` | 必填 `taskId`（MongoId）；可选 `dueAt`（DateString）；可选 nested `settings` 用 `ValidateNested + Type`，其中 `allowLate?` 为 Boolean，`maxAttempts?` 为整数且 >=1。 |
| `UpdateClassroomTaskDto` | 至少一个扁平字段：`dueAt?`（DateString，null/空字符串清空）、`allowLate?`（Boolean，null 不合法）、`maxAttempts?`（整数 >=1，null/空字符串清空）。不接受 `taskId/classroomId/publishedAt/createdBy/status` 或 nested `settings`。 |
| `UpdateClassroomTaskStatusDto` | 必填 `status`，`IsIn` 值域 `ACTIVE \| CLOSED \| RECALLED`。允许值不等同于允许状态转换，见 API Owner。 |
| [QueryClassroomTaskDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-classroom-task.dto.ts) | 分页校验；可选 `status` 使用 `TaskStatus`（`DRAFT \| PUBLISHED \| ARCHIVED`），不要误当为实例状态筛选枚举。 |

更新的扁平 `allowLate/maxAttempts` 在返回数据中位于 `settings`；清空示例：

```json
{"dueAt": null, "maxAttempts": null}
```

`ClassroomTaskResponseDto`：`{id,classroomId,taskId,status,publishedAt,dueAt?,settings?,createdBy,createdAt,updatedAt,taskPublisher,task}`。

- `status: ACTIVE | CLOSED | RECALLED`；普通列表/详情与 my-task-detail 对旧数据缺省按 ACTIVE 兼容输出。
- `taskPublisher: {id,name?} | null` 来自模板发布者，安全字段仅 id/name。
- `task={title,description,knowledgeModule,stage,difficulty?,status}`；它的 `status` 是模板状态。
- 发布候选的 Query / response 与 Task 模板 family 共用，见[发布候选模板](#发布候选模板)。

### Submission request / response family

来源：[CreateSubmissionDto](../../backend/src/modules/learning-tasks/dto/create-submission.dto.ts)、[SubmissionResponseDto](../../backend/src/modules/learning-tasks/dto/submission-response.dto.ts)、[SubmissionDetailResponseDto](../../backend/src/modules/learning-tasks/dto/submission-detail-response.dto.ts)、[ClassroomTasksService](../../backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts)。

- 通用提交与课堂任务提交复用 `CreateSubmissionDto`：`content={codeText:string,language:string}`，nested validation；可选 `meta={aiUsageDeclaration?:string}`。两项 content 字段用 `IsString`，language 无枚举白名单。请求不接受客户端指定 submission 归属或 attemptNo。
- `SubmissionResponseDto`：`{id,taskId,classroomTaskId?,studentId,attemptNo,content,meta?,status,aiFeedbackStatus,submittedAt,isLate,lateBySeconds,createdAt,updatedAt}`；`content` 同请求结构。`submittedAt` 表示提交时刻，`isLate` 是迟交标志，`lateBySeconds` 是迟交秒数。
- `SubmissionDetailResponseDto`：`{id,taskId,classroomTaskId,studentId,studentName,taskTitle,language,content,submittedAt,attemptNo,isLate,lateBySeconds,aiFeedbackStatus}`；`classroomTaskId/studentName/taskTitle/language/submittedAt/attemptNo` 可为 null，`content={language:string|null,codeText:string|null}`。
- `aiFeedbackStatus` 值域 `NOT_REQUESTED | PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`，无 job 显式返回 `NOT_REQUESTED`。后续 attempt 尚未手工 request 时也可能合法地为 NOT_REQUESTED。
- `QueryClassroomTaskSubmissionsDto` 只有分页校验，默认 `page=1,limit=20`；返回 `{items,total,page,limit}`。item 为 `{id,taskId,classroomTaskId,student,attemptNo,submittedAt,isLate,lateBySeconds,status,aiFeedbackStatus,feedbackCount}`。
- 列表 `student={id,email,roles,status,name,studentNo,employeeNo}`，后三项文本可为 null。`attemptNo` 是该学生在当前 classroomTaskId 下的独立序号，从 1 递增。
- 列表 `feedbackCount` 为该 submission 的 Feedback 总条数，涵盖 `AI/TEACHER/SYSTEM`，没有反馈时为 0；它不是 AI-only 的 `feedbackSummary.totalItems`。
- 详情允许公开 `content.codeText`；课堂任务提交列表不返回 codeText；以上投影均不返回 passwordHash。冷却错误携带公开重试提示 `retryAfterMs/retryAfterSeconds`；触发条件及错误码见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。

### My-task-detail / AI feedback summary family

[QueryMyTaskDetailDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-my-task-detail.dto.ts)：可选 `includeFeedbackItems` 用 `IsBooleanString`，默认 false，仅 `"true"` 启用；`feedbackLimit?` 经 Type(Number)，整数 `1..20`，默认 5。

顶层返回 `{classroom,classroomTask,task,me,submissions,latest,completionStatus,participationStatus}`：

- `classroom={id,name,courseId,status}`；`classroomTask={id,classroomId,taskId,status,publishedAt,dueAt?,settings?}`；`task={id,title,description,knowledgeModule,stage,difficulty?,rubric?,status}`；`me={studentId}`。
- `submissions[]`：`{id,attemptNo,createdAt,aiFeedbackStatus,feedbackSummary,feedbackItems?}`。
- `latest`：`{submissionId,attemptNo,aiFeedbackStatus,feedbackSummary,feedbackItems?} | null`；未提交时为 null。
- `feedbackSummary={totalItems,topTags,severityBreakdown}`，只统计 AI 反馈；`topTags` 为 `{tag,count}[]`；`severityBreakdown={INFO,WARN,ERROR}`。空摘要为总量 0、tags 空数组、三类严重程度计数 0。
- `feedbackItems?` 仅开启预览时返回，元素 `{source,type,severity,message,suggestion?,tags?}`，空时为 `[]`；预览上限不改变完成态。公开完成态见[学生状态 family](#student-completion--participation-public-state)。

## Query DTO / Public Response（读取接口）

本节按报表 / Analytics family 组织，保留既有章节锚点供 Service Map 定位。窗口合法值以各 Query DTO 为准；支持 `all` 的报表中，它表示当前资源口径下无时间下界，不是固定 90/180 天。前端主选项见 Route Map，不与后端兼容集合混用。

### 课程总览

来源：[QueryCourseOverviewDto](../../backend/src/modules/courses/dto/query-course-overview.dto.ts)、[CourseOverviewService](../../backend/src/modules/courses/services/course-overview.service.ts)。

- `window?: all | 1h | 24h | 7d`，`IsIn`，默认 all；`1h/24h/7d` 兼容可用。
- `sort?: studentsCount | submissionRate | overallSubmissionCoverage | aiSuccessRate | pendingJobs | failedJobs`，默认 aiSuccessRate；`order?: asc | desc`，默认 desc。
- 分页校验，默认 `page=1,limit=20`。
- item 的 `submissionRate` 保持“至少提交过一次的学生覆盖率”：`distinctStudentsSubmitted / studentsCount`，零分母为 0。
- `overallSubmissionCoverage` 是全部已发布课堂任务整体提交覆盖度：`sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`，零分母为 0；不能与 submissionRate 互换。
- `ai.aiSuccessRate` 在 `jobsTotal=0` 时为 null，否则为 `succeededJobs / jobsTotal`。上述是公开字段定义；查询与聚合实现仅见 [Service Card 08C](./handoff-backend-service-map.md#service-card-08c)。

### Learning trajectory

来源：[QueryLearningTrajectoryDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-learning-trajectory.dto.ts)、[ClassroomTasksService](../../backend/src/modules/classrooms/classroom-tasks/services/classroom-tasks.service.ts)。

- `window?: all | 7d | 24h | 30d`，默认 all，24h/30d 为兼容窗口；分页校验，默认 `page=1,limit=20`。
- `sort?: latestAttemptAt | attemptsCount | errorRate | notSubmitted`，默认 latestAttemptAt；`order?: asc | desc`，默认 desc。
- `includeAttempts? / includeTagDetails?` 用 IsBooleanString，均默认 true；显式传值时仅 `"true"` 启用，`"1"` 虽通过布尔字符串校验但不会启用。
- 返回 `{classroomId,classroomTaskId,window,generatedAt,page,limit,total,items}`。
- item：`{studentId,studentName,student,attemptsCount,latestAttemptAt,latestAiFeedbackStatus,trend,attempts}`；`student={id,name,studentNo,email}`，文本可为 null；`studentName` 为兼容字段。无提交学生也有 item，次数 0、latest 时间/AI 状态为 null。
- `trend={errorCountFirst,errorCountLatest,errorDelta,topTagsFirst,topTagsLatest}`；tags 是 `{tag,count}[]`。
- `attempts[]`：`{submissionId,attemptNo,createdAt,isLate,lateBySeconds,aiFeedbackStatus,feedbackCount,feedbackSummary}`；关闭 includeAttempts 时返回 `[]`。`feedbackCount` 是全来源总量；`feedbackSummary` 复用上文 AI-only family，关闭 tag details 时摘要 tags 为空数组。
- 不返回 passwordHash 或提交正文。页内排序与反馈聚合见 [Service Card 08E](./handoff-backend-service-map.md#service-card-08efeature-learning-trajectory-z4)。

### Review pack

来源：[QueryClassReviewPackDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts)、[ClassReviewPackService](../../backend/src/modules/classrooms/classroom-tasks/services/class-review-pack.service.ts)。

- `window?: all | 7d | 24h | 30d`，默认 all，24h/30d 为兼容窗口；`topK?` 经 Type(Number)，整数 1..30，默认 10；`examplesPerTag?` 同样转换，整数 1..5，默认 2。
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

- `window?: all | 7d | 30d | 24h | 1h`，IsIn，默认 all；24h/1h 是后端兼容窗口。
- `includeRiskStudentIds?` 用 IsBooleanString，控制风险学生样本 id 暴露。
- 返回 `{classroom,window,generatedAt,progress,atRisk,aiHealth,topTags}`；`classroom={id,name,courseId,status}`。
- `progress` 为 `{studentsCount,publishedClassroomTasks,dueClassroomTasks,distinctStudentsSubmitted,submissionRate,lateSubmissionsCount,lateStudentsCount}`。
- `atRisk={notSubmittedStudentsCount,sampleStudentIds}`；未开启 id 暴露时 sampleStudentIds 为 `[]`。
- `aiHealth={jobs,successRate,rateLimitRatio,timeoutRatio,errors}`；jobs/errors 复用 AI Metrics 中的数量与 code/count 形状，三个比率零分母为 0。风险与聚合口径见 [Service Card 08B](./handoff-backend-service-map.md#service-card-08b)。

### Process Assessment

来源：[QueryProcessAssessmentDto](../../backend/src/modules/classrooms/dto/query-process-assessment.dto.ts)、[ProcessAssessmentService](../../backend/src/modules/classrooms/services/process-assessment.service.ts)。

| Query | validation / default |
| --- | --- |
| `window?` | `IsIn`：`term \| 7d \| 30d \| all`；默认 all；term 仅兼容窗口，**24h 不合法**。 |
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
| `window?` | `IsIn`：`7d \| 30d \| term`，默认 term；不支持 all。 |
| `limitStudents? / limitAssessment?` | `Type(Number) + IsInt`，范围 1..1000，分别默认 200。 |
| `includePerTask?` | `IsBooleanString`；默认 true，显式值仅 `"true"` 启用；`"1"` 不启用。 |

稳定顶层：`{meta,course,classroom,students,classroomTasks,summary,statsByClassroomTask,statsByStudent,processAssessment}`。

- `meta={generatedAt,window,effectiveWindow,notes:string[]}`；当前 term 回显仍为 term，effectiveWindow 为 30d，notes 说明该兼容口径；不把它描述为已接入学期边界。
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
| `methodology` | `scope=AI_FEEDBACK_INTERVENTION_V1`；`version=AI_FEEDBACK_INTERVENTION_V1_1`；`sampleUnit=STUDENT_CLASSROOM_TASK`；`qualityProxy=ERROR_PLUS_HALF_WARN`；`disclaimer` 为下述公开文本。 |
| 学生摘要 | `{studentId,studentName,studentNo}`，姓名缺失/空白为 `未知学生`，学号缺失/空白为 null。 |

disclaimer：本分析仅反映 EduForge AI 反馈介入后的提交行为与代码问题代理变化，不代表 AI 对学习成绩或能力提升的因果贡献。

#### Analytics response families

| Family | Shape |
| --- | --- |
| 总览 | `{context,methodology,summary,taskTrends}`，任务趋势包含零提交任务。 |
| 学生列表 | `{context,page,limit,total,activeStudentsTotal,filters,items}`；此响应没有独立 methodology 字段。 |
| 学生详情 | `{context,methodology,student,summary,taskPoints}`；每个有效课堂任务都有 task point。 |

`activeStudentsTotal` 是全部当前 ACTIVE 学生数，不受搜索筛选影响；`total` 是组合筛选结果数。`filters={q,overallOutcome,engagementStatus}` 回显规范化值，未传项为 null；无筛选时两个总数相等。

计数 family 的精确命名如下，全部为 number，空样本计数为 0：

- 总览 summary：`activeStudentsCount`；`submittedStudentTaskCount,aiRequestedStudentTaskCount,aiDeliveredStudentTaskCount,postFeedbackResubmittedStudentTaskCount,postFeedbackCodeChangedStudentTaskCount,qualityComparableStudentTaskCount,improvedStudentTaskCount,remainedCleanStudentTaskCount,unchangedWithIssuesStudentTaskCount,stableStudentTaskCount,regressedStudentTaskCount`。
- taskTrend：`classroomTaskId,taskId,taskTitle,publishedAt`；`submittedStudentCount,aiRequestedStudentCount,aiDeliveredStudentCount,postFeedbackResubmittedStudentCount,postFeedbackCodeChangedStudentCount,qualityComparableStudentCount,improvedStudentCount,remainedCleanStudentCount,unchangedWithIssuesStudentCount,stableStudentCount,regressedStudentCount`。
- 学生 item 与详情 summary 共用 metrics：`submittedTasksCount,aiRequestedTasksCount,aiDeliveredTasksCount,postFeedbackResubmittedTasksCount,postFeedbackCodeChangedTasksCount,qualityComparableTasksCount,improvedTasksCount,remainedCleanTasksCount,unchangedWithIssuesTasksCount,stableTasksCount,regressedTasksCount`，另含 `overallOutcome,growthTrend,engagementStatus`；列表 item 还包含学生摘要。

总览 summary 与 taskTrend 共有 rate：`aiTaskCoverageRate,postFeedbackResubmissionRate,postFeedbackCodeChangeRate,qualityComparableRate,improvedRate,remainedCleanRate,unchangedWithIssuesRate,regressedRate`；summary 另有 `aiStudentCoverageRate,aiDeliveryRate`。所有 rate 在零分母时返回 0。summary、taskTrend 和学生 metrics 均返回 `averageIssueLoadBefore,averageIssueLoadAfter,averageIssueLoadDelta`，无可比样本时为 0；rate 与平均值为最多四位小数的 number。

`taskPoint`：`{classroomTaskId,taskId,taskTitle,publishedAt,attemptsCount,aiRequested,aiDelivered,postFeedbackResubmitted,postFeedbackCodeChanged,qualityComparable,issueLoadBefore,issueLoadAfter,issueLoadDelta,detailedOutcome,outcome}`。未提交点次数为 0、五个布尔值为 false；不可比较点三个 issueLoad 为 null、两种 outcome 均为 NOT_COMPARABLE。可比较点 issueLoad 是 number，delta 正值表达问题负荷减少。

#### Analytics public enums / compatibility

| 字段 | 值域 |
| --- | --- |
| `outcome` | `IMPROVED \| STABLE \| REGRESSED \| NOT_COMPARABLE` |
| `detailedOutcome` | `IMPROVED \| REMAINED_CLEAN \| UNCHANGED_WITH_ISSUES \| REGRESSED \| NOT_COMPARABLE` |
| `overallOutcome` | `INSUFFICIENT_DATA \| IMPROVED_OVERALL \| NO_NET_CHANGE \| REGRESSED_OVERALL` |
| `growthTrend` | `INSUFFICIENT_DATA \| IMPROVING \| STABLE \| DECLINING` |
| `engagementStatus` | `NO_SUBMISSION \| SUBMITTED_WITHOUT_AI_REQUEST \| AI_REQUESTED_WITHOUT_DELIVERY \| AI_DELIVERED_WITHOUT_RESUBMISSION \| RESUBMITTED_WITHOUT_COMPARABLE \| QUALITY_COMPARABLE` |

- V1.1 保留 legacy `stable*Count/growthTrend/outcome`：stable 数量涵盖 remainedClean 与 unchangedWithIssues 两类，二者都兼容投影为 outcome=STABLE；前者表示可比且前后无问题负荷，后者表示问题负荷相同且仍有问题。
- overallOutcome 表达当前任务范围净结果，growthTrend 是其 legacy 投影；NO_NET_CHANGE 可能包含改善与恶化抵消，不能理解为时间序列趋势。无可比样本时 overallOutcome/growthTrend 为 INSUFFICIENT_DATA。
- engagementStatus 表示当前范围到达的最深互斥反馈阶段。产品解释边界见 API；样本配对、anchor/postSubmission 选择、半分整数算法、比率分母及计算、搜索筛选分页执行顺序唯一由 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i) 维护。
- 以上投影不返回 codeText、submission 原文、prompt、Provider 原始响应、API key、密码/hash 或内部半分字段；学生公开摘要不暴露 email 或完整 User。

## Learning Tasks

### Task template DTO / response family

来源：[CreateTaskDto](../../backend/src/modules/learning-tasks/dto/create-task.dto.ts)、[UpdateTaskDto](../../backend/src/modules/learning-tasks/dto/update-task.dto.ts)、[QueryTaskDto](../../backend/src/modules/learning-tasks/dto/query-task.dto.ts)、[TaskResponseDto](../../backend/src/modules/learning-tasks/dto/task-response.dto.ts)。

| DTO | 字段与校验 |
| --- | --- |
| `CreateTaskDto` | 必填字符串 `title/description/knowledgeModule`，`stage` 为整数 1..4（body 不声明 Type(Number)）；可选字符串 `difficulty`、对象 `rubric:Record<string,unknown>`、`courseLabel`、`visibility` 与 `status:DRAFT \| PUBLISHED`；status 默认 DRAFT。 |
| `UpdateTaskDto` | 上述字段可选；status 的校验集合为 `DRAFT \| PUBLISHED \| ARCHIVED`，其编辑行为见 API；rubric 不静态约束内部 key。 |
| `QueryTaskDto` | 可选 `scope:mine \| shared \| all`，默认 mine，trim + lowercase，空白视为未传；可选 status、字符串 knowledgeModule、courseLabel；stage 经 Type(Number)，整数 1..4；分页校验；兼容 `createdBy` 用 IsMongoId。 |

- knowledgeModule 无枚举白名单。`courseLabel` 使用 `TASK_COURSE_LABELS` 单选白名单（如未分类、通用编程、Java 程序设计、数据结构、人工智能）；trim 后空白转 undefined。更新中显式传入空白 courseLabel 表示清空；不是 Course 外键。
- `visibility: PRIVATE | SHARED`，trim + uppercase，空白视为未传；创建默认 PRIVATE；公开读取旧数据缺省时按 SHARED 兼容。
- `courseLabel=未分类` 查询兼容匹配字段缺省/空值。`createdBy` 保留输入兼容但不提供越权筛选；scope 的可见性含义见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
- `TaskResponseDto`：`{id,title,description,knowledgeModule,courseLabel?,visibility,stage,difficulty?,rubric?,status,createdBy,publisher,createdAt,updatedAt,publishedAt?}`。`publisher={id,name?}|null`，不返回完整 User。

### 发布候选模板

来源：[QueryPublishableTaskTemplateDto](../../backend/src/modules/classrooms/classroom-tasks/dto/query-publishable-task-template.dto.ts)、[PublishableTaskTemplateResponseDto](../../backend/src/modules/classrooms/classroom-tasks/dto/publishable-task-template-response.dto.ts)。

- 可选 `courseLabel` 使用同一白名单；可选字符串 `knowledgeModule`；两者 trim 后空白转 undefined。
- `onlyMine?` 经 Transform，支持布尔/数字 true/false/1/0，以及 trim + lowercase 后对应字符串；空白视为未传，再 IsBoolean。
- `stage?` 经 Type(Number)，整数 1..4；分页校验。
- 返回 `{items,total,page,limit}`；item 为 `{id,title,description,knowledgeModule,courseLabel?,visibility,stage,difficulty?,status,createdBy,createdById,publisher,createdAt,updatedAt,publishedAt?}`；publisher 同上。候选资格与已发布排除见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)，课程分类排序见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)。

### Feedback DTO / response family

来源：[CreateFeedbackDto](../../backend/src/modules/learning-tasks/dto/create-feedback.dto.ts)、[UpdateFeedbackDto](../../backend/src/modules/learning-tasks/dto/update-feedback.dto.ts)、[FeedbackResponseDto](../../backend/src/modules/learning-tasks/dto/feedback-response.dto.ts)。

| 字段 | 公开合同 |
| --- | --- |
| `source` | 创建必填枚举 `AI \| TEACHER \| SYSTEM`；更新不可写。 |
| `type` | 创建必填，更新可选；`SYNTAX \| STYLE \| DESIGN \| BUG \| PERFORMANCE \| SECURITY \| OTHER`。 |
| `severity` | 创建必填，更新可选；`INFO \| WARN \| ERROR`。 |
| `message` | 创建必填字符串；更新可选字符串且 MinLength(1)，空字符串不合法。 |
| `suggestion` | 可选字符串；更新允许空字符串。 |
| `tags` | 可选字符串数组，IsArray + IsString(each)；教师反馈另有统一词表归一化与白名单约束。 |
| `scoreHint` | 可选 number，IsNumber，0..100。 |

更新至少一个可写字段；Update DTO 对可选字段采用 `ValidateIf(value !== undefined)`，显式 null 不合法。更新白名单不含 `source/submissionId/createdBy/createdAt/updatedAt` 或任何任务、学生、课堂归属字段。

`FeedbackResponseDto`：`{id,submissionId,createdBy?,source,type,severity,message,suggestion?,tags?,scoreHint?,createdAt,updatedAt}`。`createdBy` 为作者 id，不是 User 对象；旧 TEACHER feedback 可缺省，createdAt 是原创建时间。新建/更新时作者补写、可修改来源及权限见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。

## AI Feedback diagnostics / request family

来源：[RequestAiFeedbackDto](../../backend/src/modules/learning-tasks/dto/request-ai-feedback.dto.ts)、[QueryAiFeedbackJobsDto](../../backend/src/modules/learning-tasks/dto/query-ai-feedback-jobs.dto.ts)、[ProcessAiFeedbackJobsDto](../../backend/src/modules/learning-tasks/dto/process-ai-feedback-jobs.dto.ts)。

- `RequestAiFeedbackDto`：可选 `reason:string`，最长 200；不要求填充无意义 body 字段。
- `QueryAiFeedbackJobsDto`：可选 `status:PENDING | RUNNING | SUCCEEDED | FAILED | DEAD`；`limit` 转整数，1..100，默认 20。
- `ProcessAiFeedbackJobsDto`：可选 `batchSize`，整数 1..50，body 不声明数值字符串转换；省略时使用 Processor 的默认批次设置，配置入口见 [Config Matrix](./handoff-backend-config-matrix.md)。
- 诊断 Job item：`{id,submissionId,status,attempts,maxAttempts,notBefore,lockedAt,lockOwner,lastError?,createdAt,updatedAt}`；attempts 缺省 0、maxAttempts 缺省 3，notBefore/lockedAt/lockOwner/createdAt/updatedAt 可为 null。来源：[AiFeedbackJobService.listJobs](../../backend/src/modules/learning-tasks/ai-feedback/services/ai-feedback-job.service.ts)。
- 产品请求与 debug/ops 门禁分别见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks) 和 [API Debug / Ops](./handoff-backend-api-map.md#ai-feedback-debug--ops门禁接口)，不在数据 family 复制角色矩阵。
