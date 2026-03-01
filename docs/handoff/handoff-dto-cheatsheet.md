# DTO Cheatsheet（Write APIs）

更新时间：2026-03-01  
来源：`backend/src/modules/**/controllers/*.controller.ts` + 对应 `dto/*.dto.ts`

## 用途说明

本文件用于交接时快速给出写接口（`POST`/`PATCH`/`PUT`/`DELETE`）的最小请求体参考，帮助前端与联调脚本避免因 DTO 必填校验导致 `400`。

## 范围定义

- 仅覆盖 Controller 中声明的写接口。
- 仅抽取 request body DTO（`@Body()`）。
- `@Query()` / `@Param()` DTO 默认不展开；若某写接口无 body，本文件会标注 `No body`。
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
- Required fields: None (`UpdateProfileDto` 当前为空 DTO)
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{}
```
- Notes: Body 允许为空对象 `{}`，不要传 `null`。

---

## Courses

### POST /api/courses

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.createCourse`
- DTO: `CreateCourseDto` (`backend/src/modules/courses/dto/create-course.dto.ts`)
- Required fields:
  - `code`
  - `name`
  - `term`
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "code": "CS101",
  "name": "程序设计基础",
  "term": "2026-Spring"
}
```

### PATCH /api/courses/:id

- Controller & Method: `backend/src/modules/courses/controllers/courses.controller.ts` -> `CoursesController.updateCourse`
- DTO: `UpdateCourseDto` (`backend/src/modules/courses/dto/update-course.dto.ts`)
- Required fields: None（全部 `@IsOptional()`）
- Enums: None
- Nested structure: None
- Minimal JSON example:

```json
{
  "name": "程序设计基础（A班）"
}
```

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
- Enums:
  - `status`: `DRAFT | PUBLISHED | ARCHIVED`（from `TaskStatus`）
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
