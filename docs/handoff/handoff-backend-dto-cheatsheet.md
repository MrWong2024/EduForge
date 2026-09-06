# DTO / Public Data Contract Cheatsheet

## Scope / Owner

本文是 public request / response data contract 的 handoff quick-reference，回答“字段是什么、怎么校验、公开返回什么”。backend 源码仍是最高事实源，本文不替代源码，也不承诺穷举全部 response type。

- 覆盖 `@Body()`、`@Query()`、`@Param()` 的字段、validation / transform / whitelist、enum、nested structure、public response shape、敏感/私有字段省略与向后兼容的公开字段语义。
- DTO 声明、Controller 入参绑定、response DTO / mapper 与必要的字段处理源码共同用于核对数据合同；字段由 Service 校验时仍保留其公开输入约束。
- endpoint/path 与 `Controller & Method` 仅作定位上下文，不构成第二份 endpoint inventory；无 body 继续标注 `No body`，Minimal JSON example 继续服务于数据对接。

跨层采用 `reference, don't restate`：

- “endpoint 对外做什么”、Method/runtime Path、Controller-level Auth、状态转换与 HTTP 错误由 [Backend API Map](./handoff-backend-api-map.md) 维护。
- “内部如何承担职责与不变量”、workflow、聚合算法、查询策略、幂等与补偿由 [Backend Service Map](./handoff-backend-service-map.md) 维护。
- testing/evidence 由 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 与 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md) 维护。
- frontend consumption / mapper 与展示策略从 [Frontend API Map](./handoff-frontend-api-map.md) 及对应 Route / Component Owner 获取。

## 更新规则（必须遵守）

- 公开字段、校验、转换、枚举、嵌套结构、安全暴露或兼容语义变化时，按源码更新对应数据段落；不复制完整 endpoint inventory 或内部流程。
- Controller 路径发生变化时更新 API Map；本文只按需更新定位上下文，不积累扫描结论或阶段日志。
- 当前未展开的 request/response 按后续实际变更渐进补充；本轮不为新 Owner 定位一次性补齐全部类型。

---

## Auth

### POST /api/auth/login

- Controller & Method: `backend/src/modules/auth/controllers/auth.controller.ts` -> `AuthController.login`
- DTO: `LoginDto` (`backend/src/modules/auth/dto/login.dto.ts`)
- Required fields:
  - `email`
  - `password`
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "email": "teacher@example.com",
  "password": "123456"
}
```

### POST /api/auth/logout

- Controller & Method: `backend/src/modules/auth/controllers/auth.controller.ts` -> `AuthController.logout`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

---

## Users

### PATCH /api/users/me

- Controller & Method: `backend/src/modules/users/controllers/users.controller.ts` -> `UsersController.updateMe`
- DTO: `UpdateProfileDto` (`backend/src/modules/users/dto/update-profile.dto.ts`)
- Required fields: None（全部 `@IsOptional()`）
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "王老师",
  "studentNo": "20260001",
  "employeeNo": "T0001"
}
```
- Optional fields（全部可选）:
  - `name: string` (`@MaxLength(100)`)
  - `studentNo: string` (`@MaxLength(64)`)
  - `employeeNo: string` (`@MaxLength(64)`)
- Notes:
  - Body 允许为空对象 `{}`，不要传 `null`。
  - 仅允许更新上述 3 个字段；不允许 `email/roles/status/passwordHash`。

### POST /api/users/me/change-password

- Controller & Method: `backend/src/modules/users/controllers/users.controller.ts` -> `UsersController.changePassword`
- DTO: `ChangePasswordDto` (`backend/src/modules/users/dto/change-password.dto.ts`)
- Required fields:
  - `currentPassword` (`@IsString() @MinLength(1) @MaxLength(128)`)
  - `newPassword` (`@IsString() @MinLength(8) @MaxLength(128)`)
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "currentPassword": "TeacherPass123!",
  "newPassword": "TeacherPass456!"
}
```
- Notes:
  - 该接口只允许当前登录用户修改自己的密码，不接受 `userId`。
  - 服务层会对 `newPassword` 做 `trim` 后非空校验，拒绝纯空白密码。
  - 服务层会拒绝“新密码与当前密码相同”。
  - 改密后的会话失效策略见 [Backend API Map](./handoff-backend-api-map.md#users)，内部协作见 [Service Map](./handoff-backend-service-map.md#service-card-02)。

---

## Courses

### POST /api/courses

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.createCourse`
- DTO: `CreateCourseDto` (`backend/src/modules/courses/dto/create-course.dto.ts`)
- Required fields:
  - `code`
  - `name`
  - `term`
- Optional fields:
  - `courseLabel?: string`（课程分类，白名单来源：`TASK_COURSE_LABELS`）
- Enums:
  - `courseLabel`（可选）: `TASK_COURSE_LABELS`（与 `Task.courseLabel` 同值域）
- Nested structure: None
- Minimal JSON example:

```json
{
  "code": "CS101",
  "name": "程序设计基础",
  "term": "2026-Spring",
  "courseLabel": "程序设计基础"
}
```

### PATCH /api/courses/:id

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.updateCourse`
- DTO: `UpdateCourseDto` (`backend/src/modules/courses/dto/update-course.dto.ts`)
- Required fields: None（全部 `@IsOptional()`）
- Enums:
  - `courseLabel`（可选）: `TASK_COURSE_LABELS`（与 `Task.courseLabel` 同值域）
  - `status`（可选）: `ACTIVE | ARCHIVED`（from `CourseStatus`）
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "程序设计基础（A班）",
  "courseLabel": "数据结构"
}
```
- Archive example:

```json
{
  "status": "ARCHIVED"
}
```

- Restore example:

```json
{
  "status": "ACTIVE"
}
```
- Notes:
  - `courseLabel` 支持清空：传空字符串（如 `"courseLabel": "   "`）会在后端 trim 后按未设置处理，不会以脏值落库。
  - 归档课程仅允许通过 `status` 做恢复；仍不允许更新 `code/name/term/courseLabel`。

### POST /api/courses/:id/archive

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.archiveCourse`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

### DELETE /api/courses/:id

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.deleteCourse`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.
- Notes:
  - 删除门禁与 HTTP 错误见 [Backend API Map](./handoff-backend-api-map.md#courses)；内部引用检查见 [Service Map](./handoff-backend-service-map.md#service-card-03)。

---

## Classrooms

### POST /api/classrooms

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.createClassroom`
- DTO: `CreateClassroomDto` (`backend/src/modules/classrooms/dto/create-classroom.dto.ts`)
- Required fields:
  - `courseId` (MongoId)
  - `name`
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "courseId": "64f10c5a9c8f4a1b2c3d4e5f",
  "name": "高一(3)班"
}
```

### PATCH /api/classrooms/:id

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.updateClassroom`
- DTO: `UpdateClassroomDto` (`backend/src/modules/classrooms/dto/update-classroom.dto.ts`)
- Required fields: None（全部 `@IsOptional()`）
- Enums:
  - `status`（可选）: `ACTIVE | ARCHIVED`（from `ClassroomStatus`）
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "高一(3)班（晚修）"
}
```

- Archive example:

```json
{
  "status": "ARCHIVED"
}
```

- Restore example:

```json
{
  "status": "ACTIVE"
}
```

### POST /api/classrooms/join

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.joinClassroom`
- DTO: `JoinClassroomDto` (`backend/src/modules/classrooms/dto/join-classroom.dto.ts`)
- Required fields:
  - `joinCode`
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "joinCode": "ABCD12"
}
```

### POST /api/classrooms/:id/archive

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.archiveClassroom`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

### DELETE /api/classrooms/:id

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.deleteClassroom`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.
- Notes:
  - 删除门禁与 HTTP 错误见 [Backend API Map](./handoff-backend-api-map.md#classrooms)；Enrollment 历史与 legacy 防御检查见 [Service Map](./handoff-backend-service-map.md#service-card-04)。

### POST /api/classrooms/:id/students/:uid/remove

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.removeStudent`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

---

## Classroom Tasks（Classrooms 子资源）

### POST /api/classrooms/:id/tasks

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.createClassroomTask`
- DTO: `CreateClassroomTaskDto` (`backend/src/modules/classrooms/classroom-tasks/dto/create-classroom-task.dto.ts`)
- Required fields:
  - `taskId` (MongoId)
- Enums: None
- Nested structure:
  - `settings.allowLate?: boolean`
  - `settings.maxAttempts?: number (>= 1)`
- Notes:
  - `dueAt` 在 DTO 中为可选（`@IsOptional() + @IsDateString()`），不是必填；但建议联调时填写，用于覆盖截止时间/迟交相关流程。
- Minimal JSON example:

```json
{
  "taskId": "64f10c5a9c8f4a1b2c3d4e5f",
  "dueAt": "2026-03-15T09:00:00.000Z",
  "settings": {
    "allowLate": false
  }
}
```

### PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.updateClassroomTask`
- DTO: `UpdateClassroomTaskDto` (`backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task.dto.ts`)
- Required fields: None（PATCH 至少传 1 个可更新字段）
- Allowed fields:
  - `dueAt?: string | null`（`null` 或空字符串表示清空截止时间）
  - `allowLate?: boolean`
  - `maxAttempts?: number | null`（`null` 或空字符串表示清空最大尝试次数）
- Enums: None
- Nested structure: None（扁平字段；由 service 映射到 `ClassroomTask.settings`）
- Minimal JSON example:

```json
{
  "dueAt": "2026-04-12T23:59:00.000Z",
  "allowLate": false,
  "maxAttempts": 3
}
```
- Clear example:

```json
{
  "dueAt": null,
  "maxAttempts": null
}
```
- Notes:
  - 仅允许教师操作，且仅限班级 owner。
  - 仅允许更新实例级字段：`dueAt / settings.allowLate / settings.maxAttempts`。
  - 不允许更新 `taskId/classroomId/publishedAt/createdBy/status`。
  - 状态边界：`ACTIVE/CLOSED` 可编辑，`RECALLED` 不可编辑。

### POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.createClassroomTaskSubmission`
- DTO: `CreateSubmissionDto` (`backend/src/modules/learning-tasks/dto/create-submission.dto.ts`)
- Required fields:
  - `content.codeText`
  - `content.language`
- Enums: None
- language constraint:
  - `content.language` 当前仅 `@IsString()`，未做 `@IsEnum`/白名单限制。
- Nested structure:
  - `content.codeText: string`
  - `content.language: string`
  - `meta.aiUsageDeclaration?: string`
- Notes:
  - 提交前会校验 `ClassroomTask.status`：仅 `ACTIVE` 接受新提交；`CLOSED/RECALLED` 会被拒绝。
- Minimal JSON example（脱敏示例；`codeText` 为必填但值不含真实内容）:

```json
{
  "content": {
    "codeText": "<REDACTED_CODE_TEXT>",
    "language": "javascript"
  }
}
```

### PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId/status

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.updateClassroomTaskStatus`
- DTO: `UpdateClassroomTaskStatusDto` (`backend/src/modules/classrooms/classroom-tasks/dto/update-classroom-task-status.dto.ts`)
- Required fields:
  - `status`（`@IsIn(CLASSROOM_TASK_MUTABLE_STATUSES)`）
- Enums:
  - `status`: `ACTIVE | CLOSED | RECALLED`
- Nested structure: None
- Minimal JSON example:

```json
{
  "status": "CLOSED"
}
```
- Notes:
  - ClassroomTask 生命周期与 endpoint-level 状态转换、拒绝规则由 [Backend API Map](./handoff-backend-api-map.md) 维护；本节只记录 request/response 字段与 validation。

---

## Learning Tasks

### POST /api/learning-tasks/tasks

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.createTask`
- DTO: `CreateTaskDto` (`backend/src/modules/learning-tasks/dto/create-task.dto.ts`)
- Required fields:
  - `title`
  - `description`
  - `knowledgeModule`
  - `stage` (1~4)
- Optional fields:
  - `status?: TaskStatus`（`@IsOptional() @IsIn(CREATE_TASK_ALLOWED_STATUSES)`；缺省按 `DRAFT` 创建）
  - `courseLabel?: string`（单选课程分类；来源白名单：`backend/src/modules/learning-tasks/task-course-labels.constants.ts`）
  - `visibility?: string`（模板可见性；来源白名单：`backend/src/modules/learning-tasks/task-template-visibility.constants.ts`）
- Enums:
  - `status`（创建允许值）: `DRAFT | PUBLISHED`；不允许初始 `ARCHIVED`
  - `courseLabel`（可选）: `TASK_COURSE_LABELS`（例如：`未分类`、`通用编程`、`Java 程序设计`、`数据结构`、`人工智能`）
  - `visibility`（可选）: `PRIVATE | SHARED`（缺省默认 `PRIVATE`）
- knowledgeModule constraint:
  - `knowledgeModule` 当前仅 `@IsString()`，未做 `@IsEnum`/白名单限制。
- Nested structure:
  - `rubric?: Record<string, unknown>`（不可静态推断内部 key）
- Minimal JSON example:

```json
{
  "title": "循环结构练习",
  "description": "完成 for/while 基础练习",
  "knowledgeModule": "control-flow",
  "courseLabel": "程序设计基础",
  "visibility": "PRIVATE",
  "stage": 1,
  "status": "DRAFT"
}
```

### PATCH /api/learning-tasks/tasks/:id

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.updateTask`
- DTO: `UpdateTaskDto` (`backend/src/modules/learning-tasks/dto/update-task.dto.ts`)
- Required fields: None（全部 `@IsOptional()`）
- Enums:
  - `status`（可选）: `DRAFT | PUBLISHED | ARCHIVED`
  - `courseLabel`（可选）: `TASK_COURSE_LABELS`（单选）
  - `visibility`（可选）: `PRIVATE | SHARED`
- knowledgeModule constraint:
  - `knowledgeModule`（可选）当前仅 `@IsString()`，未做 `@IsEnum`/白名单限制。
- Nested structure:
  - `rubric?: Record<string, unknown>`（不可静态推断内部 key）
- Minimal JSON example:

```json
{
  "title": "循环结构练习（修订）"
}
```

- 清空 `courseLabel` 方式：
  - 传空字符串（如 `"courseLabel": "   "`）会在后端 trim 后按未设置处理，不会以脏字符串落库。
- `visibility` 变更方式：
  - 作者可在 `PATCH` 中传 `"visibility":"PRIVATE"` 或 `"visibility":"SHARED"` 切换模板是否进入共享池。

### POST /api/learning-tasks/tasks/:id/publish

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.publishTask`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

### POST /api/learning-tasks/tasks/:id/submissions

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.createSubmission`
- DTO: `CreateSubmissionDto` (`backend/src/modules/learning-tasks/dto/create-submission.dto.ts`)
- Required fields:
  - `content.codeText`
  - `content.language`
- Enums: None
- language constraint:
  - `content.language` 当前仅 `@IsString()`，未做 `@IsEnum`/白名单限制。
- Nested structure:
  - `content.codeText: string`
  - `content.language: string`
  - `meta.aiUsageDeclaration?: string`
- Minimal JSON example（脱敏示例）:

```json
{
  "content": {
    "codeText": "<REDACTED_CODE_TEXT>",
    "language": "python"
  }
}
```

### POST /api/learning-tasks/submissions/:id/feedback

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.createFeedback`
- DTO: `CreateFeedbackDto` (`backend/src/modules/learning-tasks/dto/create-feedback.dto.ts`)
- Required fields:
  - `source`
  - `type`
  - `severity`
  - `message`
- Enums:
  - `source`: `AI | TEACHER | SYSTEM`
  - `type`: `SYNTAX | STYLE | DESIGN | BUG | PERFORMANCE | SECURITY | OTHER`
  - `severity`: `INFO | WARN | ERROR`
- Nested structure: None
- Minimal JSON example:

```json
{
  "source": "TEACHER",
  "type": "STYLE",
  "severity": "WARN",
  "message": "命名可读性需要提升"
}
```
- Response notes:
  - 返回单条 feedback response，含 `id/submissionId/source/type/severity/message/suggestion/tags/scoreHint/createdAt/updatedAt`。
  - 当 `source=TEACHER` 时，新建反馈会写入并返回 `createdBy`；旧数据缺失 `createdBy` 时，公开响应允许该字段缺省。

### PATCH /api/learning-tasks/submissions/:submissionId/feedback/:feedbackId

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.updateFeedback`
- DTO: `UpdateFeedbackDto` (`backend/src/modules/learning-tasks/dto/update-feedback.dto.ts`)
- Required fields: None（但 service 要求至少传 1 个可更新字段）
- Allowed fields:
  - `type?: FeedbackType`
  - `severity?: FeedbackSeverity`
  - `message?: string`（空字符串会被拒绝）
  - `suggestion?: string`（允许空字符串）
  - `tags?: FeedbackTag[]`（继续走统一词表归一化与白名单校验）
  - `scoreHint?: number`（0~100）
- Forbidden fields:
  - `source/submissionId/createdBy/createdAt/updatedAt` 以及任务、学生、课堂归属字段。
- Enums:
  - `type`: `SYNTAX | STYLE | DESIGN | BUG | PERFORMANCE | SECURITY | OTHER`
  - `severity`: `INFO | WARN | ERROR`
- Nested structure: None
- Minimal JSON example:

```json
{
  "message": "命名可读性已有改善，但拆分函数会更清晰",
  "severity": "INFO",
  "tags": ["readability"],
  "scoreHint": 86
}
```

- Notes:
  - 仅允许教师修改自己有权管理的 `TEACHER` 来源反馈。
  - `AI/SYSTEM` 来源反馈只读，返回 `403 Only teacher feedback can be updated`。
  - 旧 `TEACHER` feedback 缺少 `createdBy` 时，具备 submission 管理权限的教师可更新；更新成功后补写 `createdBy`，不改 `createdAt`。
  - 返回单条 feedback response，含 `createdBy/createdAt/updatedAt`。

### POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.requestAiFeedback`
- DTO: `RequestAiFeedbackDto` (`backend/src/modules/learning-tasks/dto/request-ai-feedback.dto.ts`)
- Required fields: None（`reason` 可选）
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{}
```

### POST /api/learning-tasks/ai-feedback/jobs/process-once

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.processAiFeedbackOnce`
- DTO: `ProcessAiFeedbackJobsDto` (`backend/src/modules/learning-tasks/dto/process-ai-feedback-jobs.dto.ts`)
- Required fields: None（`batchSize` 可选）
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "batchSize": 10
}
```

---

## 备注

- 对于 `Record<string, unknown>`（如 `rubric`），内部结构不可静态推断，示例仅给出保守最小可用体。
- 对于包含 `codeText` 的提交 DTO，示例值已脱敏；实际联调请使用真实提交内容。
- 示例中的 `courseId`/`taskId`/`classroomId`/`classroomTaskId`/`submissionId` 等 MongoId 均为占位值；联调时请替换为真实 id，避免将 `404` 误判为 DTO 校验问题。

---

## Query DTO / Public Response（读取接口）

### GET /api/classrooms/:id/students

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.listStudents`
- Query DTO: `QueryClassroomStudentsDto` (`backend/src/modules/classrooms/dto/query-classroom-students.dto.ts`)
- Fields:
  - `page?: number` (`@Type(() => Number) @IsInt() @Min(1)`)
  - `limit?: number` (`@Type(() => Number) @IsInt() @Min(1) @Max(100)`)
  - `includeRemoved?: string` (`@IsBooleanString()`；支持 `0/1/true/false`)
- Example Query:
  - `/api/classrooms/{id}/students?page=1&limit=20`
  - `/api/classrooms/{id}/students?page=1&limit=20&includeRemoved=1`
- Response口径（最小说明）:
  - `items[*]` 包含 `id/email/roles/status/name/studentNo/employeeNo/joinedAt`
  - 成员来源只认 Enrollment（`role=STUDENT`）；默认 `status=ACTIVE`，`includeRemoved=1/true` 时包含 `REMOVED`
  - 不返回 `passwordHash`

### GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.listClassroomTaskSubmissions`
- Query DTO: `QueryClassroomTaskSubmissionsDto` (`backend/src/modules/classrooms/classroom-tasks/dto/query-classroom-task-submissions.dto.ts`)
- Fields:
  - `page?: number` (`@Type(() => Number) @IsInt() @Min(1)`)
  - `limit?: number` (`@Type(() => Number) @IsInt() @Min(1) @Max(100)`)
- Example Query:
  - `/api/classrooms/{classroomId}/tasks/{classroomTaskId}/submissions?page=1&limit=20`
- Response口径（最小说明）:
  - `items[*]` 包含 `id/taskId/classroomTaskId/student/attemptNo/submittedAt/isLate/lateBySeconds/status/aiFeedbackStatus`
  - `items[*].attemptNo` 表示“该学生在当前 `classroomTaskId` 下的第几次提交”，按该 `classroomTaskId` 独立从 `1` 递增
  - 列表只按 `classroomTaskId` 查询，不按 `taskId` 跨班聚合
  - 无 job 时 `aiFeedbackStatus = NOT_REQUESTED`
  - 不返回 `passwordHash`、不返回 `content.codeText`

### GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.getReviewPack`
- Query DTO: `QueryClassReviewPackDto` (`backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts`)
- Fields:
  - `window?: 'all' | '7d' | '24h' | '30d'`（`@IsIn(CLASS_REVIEW_PACK_WINDOWS)`；默认 `all`）
  - `topK?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(30)`）
  - `examplesPerTag?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(5)`）
- Example Query:
  - `/api/classrooms/{classroomId}/tasks/{classroomTaskId}/review-pack?window=all&topK=10&examplesPerTag=2`
- Response口径（最小说明）:
  - 核心域：`overview`、`commonIssues`、`examples`、`studentTiers`
  - `examples` 为去重典型样例池（按 `feedbackId` 去重，不再按 tag 分组重复占位）
  - `examples[*]` 含 `feedbackId/submissionId/attemptNo/severity/type/message/suggestion/source/primaryTag/matchedTags/tags`
  - `topTags` 仍按标签展开统计（多标签 feedback 同时计入多个 tag）
  - `examples` 不返回 `codeText/prompt/apiKey`
  - `studentTiers.good/watch/notSubmitted[*]` 统一含 `studentId/studentName/studentNo`，其中 `good/watch` 额外含 `attemptsCount/latestErrorCount`
  - `studentName` 缺失时回落 `未知学生`
  - 响应不再包含 `actionItems`、`teacherScript`

### GET /api/classrooms/:classroomId/weekly-report

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.getClassroomWeeklyReport`
- Query DTO: `QueryClassroomWeeklyReportDto` (`backend/src/modules/classrooms/dto/query-classroom-weekly-report.dto.ts`)
- Fields:
  - `window?: 'all' | '7d' | '30d' | '24h' | '1h'`（`@IsIn(CLASSROOM_WEEKLY_REPORT_WINDOWS)`；默认 `all`）
  - `includeRiskStudentIds?: string`（`@IsBooleanString()`）
- Example Query:
  - `/api/classrooms/{classroomId}/weekly-report?window=all&includeRiskStudentIds=true`
- Window 语义:
  - `all` = 当前班级报表口径下全部历史记录（无时间下界过滤）
  - `24h/1h` 为后端兼容窗口，不作为推荐默认窗口

### GET /api/classrooms/:classroomId/process-assessment

- Controller & Method: `backend/src/modules/classrooms/controllers/classrooms.controller.ts` -> `ClassroomsController.getProcessAssessment`
- Query DTO: `QueryProcessAssessmentDto` (`backend/src/modules/classrooms/dto/query-process-assessment.dto.ts`)
- Fields:
  - `window?: 'all' | '7d' | '30d' | 'term'`（`@IsIn(PROCESS_ASSESSMENT_WINDOWS)`；默认 `all`）
  - `page?: number`（`@Type(() => Number) @IsInt() @Min(1)`）
  - `limit?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(100)`）
  - `sort?: 'score' | 'submissionsCount' | 'submittedTasksCount' | 'aiRequestedCount' | 'riskLevel'`
  - `order?: 'asc' | 'desc'`
  - `excludedTaskIds?: string | string[]`（optional；支持逗号分隔或 repeated query；每个 id 应为 MongoId）
- Example Query:
  - `/api/classrooms/{classroomId}/process-assessment?window=all&page=1&limit=50&sort=score&order=desc`
  - `/api/classrooms/{classroomId}/process-assessment?window=all&excludedTaskIds=64f10c5a9c8f4a1b2c3d4e5f,64f10c5a9c8f4a1b2c3d4e60`
- Window 语义:
  - `all` = 当前班级过程性评价口径下全部历史记录（无时间下界过滤）
  - `term` 为后端兼容窗口
  - CSV 接口 `GET /api/classrooms/:classroomId/process-assessment.csv` 复用同窗口与 `excludedTaskIds` 语义
- Response 关键口径（items）:
  - `items[*]` 稳定返回 `studentId/studentName/studentNo`（不再仅有 `studentId`）
  - `studentName`：优先用户姓名，缺失/空白时回落 `未知学生`
  - `studentNo`：优先用户学号，缺失/空白时返回 `null`
  - `items[*]` 评分解释字段包含 `iteratedTasksCount/aiRequestedTasksCount/aiSucceededTasksCount/avgWarnItems`；原 `aiRequestedCount/aiSucceededCount` 继续表示总 AI 请求/成功次数
  - `avgFeedbackItems/avgWarnItems/avgErrorItems` 按任务维度统计：每个学生每个有效任务取最新一次有 AI 反馈项的提交，INFO 只进 `avgFeedbackItems`，WARN 进 `avgWarnItems`，ERROR 进 `avgErrorItems`
  - rubric 固定为任务覆盖率 0.45、提交迭代质量 0.15、AI 使用质量 0.2、代码质量代理 0.2；`submissionsCount <= 0` 或排除全部任务时 `score=0`
  - CSV 同步包含 `studentName,studentNo,studentId` 列（列顺序在前部），以及 `iteratedTasksCount/aiRequestedTasksCount/aiSucceededTasksCount/avgWarnItems`；继续保留 `aiRequestedCount/aiSucceededCount` 次数字段
  - 任务排除会重新计算 `publishedTasksCount/submittedTasksRate/submissions/iteration/late/AI job/AI task coverage/AI task success/AI feedback/topTags/score/risk`；排除全部任务时仍返回 ACTIVE 学生且任务相关统计与 `score` 为 0

### GET /api/courses/:courseId/overview

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.getCourseOverview`
- Query DTO: `QueryCourseOverviewDto` (`backend/src/modules/courses/dto/query-course-overview.dto.ts`)
- Fields:
  - `window?: 'all' | '1h' | '24h' | '7d'`（`@IsIn(COURSE_OVERVIEW_WINDOWS)`；默认 `all`）
  - `sort?: 'studentsCount' | 'submissionRate' | 'overallSubmissionCoverage' | 'aiSuccessRate' | 'pendingJobs' | 'failedJobs'`
  - `order?: 'asc' | 'desc'`
  - `page?: number`（`@Type(() => Number) @IsInt() @Min(1)`）
  - `limit?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(100)`；默认 `20`）
- Example Query:
  - `/api/courses/{courseId}/overview?window=all&sort=aiSuccessRate&order=desc&page=1&limit=20`
- Window 语义:
  - `all` = 当前课程总览口径下全部历史记录（无时间下界过滤）
  - `1h/24h/7d` 为兼容窗口，继续可用
- Response 关键口径（items）:
  - `submissionRate` 保持兼容语义：`distinctStudentsSubmitted / studentsCount`（至少提交过一次的学生覆盖率）
  - `overallSubmissionCoverage` 为“班级全部已发布课堂任务整体提交覆盖度”：`sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`，分母为 `0` 时返回 `0`
  - `ai.aiSuccessRate`：`jobsTotal=0` 返回 `null`；`jobsTotal>0` 返回 `succeededJobs / jobsTotal`

### GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.getLearningTrajectory`
- Query DTO: `QueryLearningTrajectoryDto` (`backend/src/modules/classrooms/classroom-tasks/dto/query-learning-trajectory.dto.ts`)
- Fields:
  - `window?: 'all' | '7d' | '24h' | '30d'`（`@IsIn(LEARNING_TRAJECTORY_WINDOWS)`；默认 `all`）
  - `page?: number`（`@Type(() => Number) @IsInt() @Min(1)`）
  - `limit?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(100)`）
  - `sort?: 'latestAttemptAt' | 'attemptsCount' | 'errorRate' | 'notSubmitted'`
  - `order?: 'asc' | 'desc'`
  - `includeAttempts?: string`（`@IsBooleanString()`）
  - `includeTagDetails?: string`（`@IsBooleanString()`）
- Example Query:
  - `/api/classrooms/{classroomId}/tasks/{classroomTaskId}/learning-trajectory?window=all&page=1&limit=20`
- Window 语义:
  - `all` = 当前课堂任务学习轨迹口径下全部历史记录（无时间下界过滤）
  - `24h/30d` 为后端兼容窗口

### 统计窗口契约分层说明

- 后端兼容支持集合：以上 Query DTO 的 `@IsIn(...)` 允许值（含兼容窗口）。
- 前端窗口展示策略见 [Frontend Route Map](./handoff-frontend-route-map.md)，不在本文复制当前展示集合。
- 课程总览窗口契约：`GET /api/courses/:courseId/overview` 默认 `all`，兼容 `all/1h/24h/7d`，其中 `all` 表示无时间下界过滤。
- `ai-metrics` DTO 保持不变：`window` 仍仅支持 `1h | 24h | 7d`，不引入 `all`。

### GET /api/learning-tasks/tasks

- Controller & Method: `backend/src/modules/learning-tasks/controllers/learning-tasks.controller.ts` -> `LearningTasksController.listTasks`
- Query DTO: `QueryTaskDto` (`backend/src/modules/learning-tasks/dto/query-task.dto.ts`)
- Fields:
  - `scope?: 'mine' | 'shared' | 'all'`（来源白名单 `TASK_TEMPLATE_SCOPES`，默认 `mine`）
  - `status?: TaskStatus`
  - `knowledgeModule?: string`
  - `courseLabel?: string`（单选；来源白名单 `TASK_COURSE_LABELS`）
  - `stage?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(4)`）
  - `page?: number`（`@Type(() => Number) @IsInt() @Min(1)`）
  - `limit?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(100)`）
  - `createdBy?: string`（`@IsMongoId()`，仅保留兼容；当前以 `scope` 语义为主）
- Example Query:
  - `/api/learning-tasks/tasks?page=1&limit=20`（默认 `scope=mine`）
  - `/api/learning-tasks/tasks?scope=shared&status=PUBLISHED&page=1&limit=20`
  - `/api/learning-tasks/tasks?scope=all&courseLabel=Java%20%E7%A8%8B%E5%BA%8F%E8%AE%BE%E8%AE%A1&page=1&limit=20`
- Response口径（最小说明）:
  - `items[*]` 包含 `courseLabel`（可选）与 `visibility`（必返，旧数据缺省时按 `SHARED` 兼容输出）
  - `scope=mine`：仅当前教师本人模板（包含本人 `PRIVATE + SHARED`）
  - `scope=shared`：共享池（`visibility=SHARED`，且包含旧数据缺省 `visibility`；包含“我自己设为 SHARED 的模板”）
  - `scope=all`：当前教师可见全集（我的全部 + 共享池）
  - `status/knowledgeModule/stage` 可与 `scope/courseLabel` 组合筛选；内部查询实现见 [Service Map](./handoff-backend-service-map.md#service-card-08)。
  - 当 `courseLabel=未分类` 时，服务端会同时匹配“字段缺省/空值”任务，保持旧数据兼容。

### GET /api/classrooms/:id/publishable-task-templates

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.listPublishableTaskTemplates`
- Query DTO: `QueryPublishableTaskTemplateDto` (`backend/src/modules/classrooms/classroom-tasks/dto/query-publishable-task-template.dto.ts`)
- Fields:
  - `courseLabel?: string`（单选；来源白名单 `TASK_COURSE_LABELS`）
  - `onlyMine?: boolean`（支持 `true/false/1/0`）
  - `knowledgeModule?: string`
  - `stage?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(4)`）
  - `page?: number`（`@Type(() => Number) @IsInt() @Min(1)`）
  - `limit?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(100)`）
- Example Query:
  - `/api/classrooms/{id}/publishable-task-templates?page=1&limit=20`
  - `/api/classrooms/{id}/publishable-task-templates?onlyMine=true&courseLabel=Java%20%E7%A8%8B%E5%BA%8F%E8%AE%BE%E8%AE%A1&page=1&limit=20`
- Response口径（最小说明）:
  - 固定内置：只返回当前教师可见模板（自己私有 + 自己共享 + 他人共享）
  - 固定内置：只返回 `status=PUBLISHED`
  - 固定内置：自动排除当前班级已发布过的模板（按 `classroomTask.taskId` 去重）
  - 未显式传 `courseLabel` 且班级课程存在 `courseLabel` 时，排序优先当前课程分类匹配模板
