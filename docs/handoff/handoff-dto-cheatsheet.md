# DTO Cheatsheet（Write APIs）

更新时间：2026-04-04  
来源：`backend/src/modules/**/controllers/*.controller.ts` + 对应 `dto/*.dto.ts`

## 用途说明

本文件用于交接时快速给出写接口（`POST`/`PATCH`/`PUT`/`DELETE`）的最小请求体参考，帮助前端与联调脚本避免因 DTO 必填校验导致 `400`。

## 范围定义

- 仅覆盖 Controller 中声明的写接口。
- 仅抽取 request body DTO（`@Body()`）。
- `@Query()` / `@Param()` DTO 默认不展开；若某写接口无 body，本文件会标注 `No body`。
- 例外：为承接 P0 后端补齐，本文件末尾补充了 2 个正式读取接口的 Query DTO（分页参数）。
- 运行态路径按全局前缀 `api` 书写为 `/api/...`。

## 更新规则（必须遵守）

- DTO 以代码为准：`backend/src/modules/**/dto/*.dto.ts`。
- 若 DTO 字段、校验装饰器、枚举、嵌套结构有变更，必须同步更新本文件对应接口段落。
- 若 `handoff-api-map` 与 Controller 路径不一致，以 Controller 真实路径为准，并在本文件标注差异。
- 本次扫描未发现路径冲突（与 `docs/handoff/handoff-api-map.md` 一致）。

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
  - 改密成功后保留当前会话，并失效该用户其它历史会话。

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
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "程序设计基础（A班）",
  "courseLabel": "数据结构"
}
```
- Notes:
  - `courseLabel` 支持清空：传空字符串（如 `"courseLabel": "   "`）会在后端 trim 后按未设置处理，不会以脏值落库。

### POST /api/courses/:id/archive

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.archiveCourse`
- DTO: No body
- Required fields: None
- Enums: None
- Nested structure: None
- Minimal request: No body (`Content-Length: 0`). Do not send JSON `null`.

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
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "高一(3)班（晚修）"
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
- Minimal JSON example（脱敏示例；`codeText` 为必填但值不含真实内容）:

```json
{
  "content": {
    "codeText": "<REDACTED_CODE_TEXT>",
    "language": "javascript"
  }
}
```

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
  - `status`
- Optional fields:
  - `courseLabel?: string`（单选课程分类；来源白名单：`backend/src/modules/learning-tasks/task-course-labels.constants.ts`）
  - `visibility?: string`（模板可见性；来源白名单：`backend/src/modules/learning-tasks/task-template-visibility.constants.ts`）
- Enums:
  - `status`: `DRAFT | PUBLISHED | ARCHIVED`（from `TaskStatus`）
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

## Query DTO 补充（读取接口）

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
  - 列表只按 `classroomTaskId` 查询，不按 `taskId` 跨班聚合
  - 无 job 时 `aiFeedbackStatus = NOT_REQUESTED`
  - 不返回 `passwordHash`、不返回 `content.codeText`

### GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack

- Controller & Method: `backend/src/modules/classrooms/classroom-tasks/controllers/classroom-tasks.controller.ts` -> `ClassroomTasksController.getReviewPack`
- Query DTO: `QueryClassReviewPackDto` (`backend/src/modules/classrooms/classroom-tasks/dto/query-class-review-pack.dto.ts`)
- Fields:
  - `window?: '24h' | '7d' | '30d'`（`@IsIn(CLASS_REVIEW_PACK_WINDOWS)`）
  - `topK?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(30)`）
  - `examplesPerTag?: number`（`@Type(() => Number) @IsInt() @Min(1) @Max(5)`）
- Example Query:
  - `/api/classrooms/{classroomId}/tasks/{classroomTaskId}/review-pack?window=7d&topK=10&examplesPerTag=2`
- Response口径（最小说明）:
  - 核心域：`overview`、`commonIssues`、`examples`、`studentTiers`
  - `examples` 为去重典型样例池（按 `feedbackId` 去重，不再按 tag 分组重复占位）
  - `examples[*]` 含 `feedbackId/submissionId/attemptNo/severity/type/message/suggestion/source/primaryTag/matchedTags/tags`
  - `topTags` 仍按标签展开统计（多标签 feedback 同时计入多个 tag）
  - `examples` 不返回 `codeText/prompt/apiKey`
  - `studentTiers.good/watch/notSubmitted[*]` 统一含 `studentId/studentName/studentNo`，其中 `good/watch` 额外含 `attemptsCount/latestErrorCount`
  - `studentName` 缺失时回落 `未知学生`
  - 响应不再包含 `actionItems`、`teacherScript`

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
  - `status/knowledgeModule/stage` 已在后端进入数据库级过滤（与 `scope/courseLabel` 可叠加）。
  - 当 `courseLabel=未分类` 时，服务端会同时匹配“字段缺省/空值”任务，保持旧数据兼容。
  - 当前前端任务模板页若仍在本地处理 `status/knowledgeModule/stage`，属前端接入阶段问题；后端查询契约已就绪。

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
