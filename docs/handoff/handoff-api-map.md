# 接口地图（Controller Scan）

全局前缀：运行态由 `src/main.ts` 统一加 `api` 前缀。下文路径按运行态写为 `/api/...`。

## App

| Method | Path | 用途 |
|---|---|---|
| GET | `/api` | 基础连通性返回（Hello World）。 |

## Auth

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/auth/login` | 登录并写入 `ef_session` Cookie（HttpOnly）。 |
| POST | `/api/auth/logout` | 注销并清除 `ef_session` Cookie。 |

## Users

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/users/me` | 读取当前会话用户公开信息。 |
| PATCH | `/api/users/me` | 预留“更新个人资料”入口（当前 service 返回 `null`）。 |

## Courses

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/courses` | 教师创建课程。 |
| PATCH | `/api/courses/:id` | 教师更新课程（归属校验 + 归档限制）。 |
| GET | `/api/courses` | 教师分页查询课程。 |
| GET | `/api/courses/:id` | 教师获取单课程详情。 |
| POST | `/api/courses/:id/archive` | 归档课程。 |

## Classrooms

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms` | 教师创建班级并分配 `joinCode`。 |
| PATCH | `/api/classrooms/:id` | 教师更新班级。 |
| GET | `/api/classrooms` | 教师分页查询班级。 |
| POST | `/api/classrooms/join` | 学生通过 `joinCode` 入班。 |
| GET | `/api/classrooms/mine/dashboard` | 学生学习看板（按 `classroomTaskId` 聚合个人提交与 AI 状态）。 |
| GET | `/api/classrooms/:id/dashboard` | 教师班级看板（按 `classroomTaskId` 聚合提交/AI 状态/tags）。 |
| GET | `/api/classrooms/:id` | 获取班级详情（teacher owner 或 student member）。 |
| POST | `/api/classrooms/:id/archive` | 教师归档班级。 |
| POST | `/api/classrooms/:id/students/:uid/remove` | 教师移除学生。 |

## Classroom Tasks（Classrooms 子资源）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms/:id/tasks` | 教师将已发布 Task 发布到班级（生成 ClassroomTask 实例）。 |
| GET | `/api/classrooms/:id/tasks` | 教师/学生查看班级任务列表。 |
| GET | `/api/classrooms/:id/tasks/:classroomTaskId` | 教师/学生查看班级任务详情。 |
| POST | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` | **班级发布实例提交入口**；学生提交被绑定到 `classroomTaskId`，是隔离关键点。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` | AI 运行指标报表（按 `classroomTaskId` 隔离）；Query: `window`/`includeTags`。 |

Notes:
- `window`: `1h|24h|7d`，默认 `24h`
- `includeTags`: `true|false`，默认 `true`
- 权限口径：登录态 + teacher（`TEACHER_ROLES`）+ 必须是该 `classroomId` 的 teacher owner
- 脱敏：不返回 `codeText`/`prompt`/`key`，仅返回错误码聚合与计数

## Learning Tasks

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/learning-tasks/tasks` | 创建任务。 |
| PATCH | `/api/learning-tasks/tasks/:id` | 更新任务。 |
| POST | `/api/learning-tasks/tasks/:id/publish` | 发布任务。 |
| GET | `/api/learning-tasks/tasks` | 分页查询任务。 |
| GET | `/api/learning-tasks/tasks/:id` | 任务详情。 |
| POST | `/api/learning-tasks/tasks/:id/submissions` | 通用任务提交入口（可无 `classroomTaskId`）。 |
| GET | `/api/learning-tasks/tasks/:id/submissions/mine` | 学生查看自己的提交与 `aiFeedbackStatus`。 |
| GET | `/api/learning-tasks/tasks/:id/submissions` | 教师分页查看某任务提交。 |
| POST | `/api/learning-tasks/submissions/:id/feedback` | 教师新增反馈（AI/TEACHER/SYSTEM 结构统一）。 |
| GET | `/api/learning-tasks/submissions/:id/feedback` | 提交反馈列表（学生本人或任务教师可见）。 |
| POST | `/api/learning-tasks/submissions/:submissionId/ai-feedback/request` | 手工触发 AI 入队请求：仅创建/确保 `PENDING` job（幂等），不直接执行分析；用于 attempt-based 下的 `NOT_REQUESTED` submission。`attemptNo>1` 默认不自动 enqueue，需显式 request 才会生成 job。该接口是产品能力，不受 `AI_FEEDBACK_DEBUG_ENABLED` 门禁影响，但受登录 + RBAC + 资源归属校验。 |
| GET | `/api/learning-tasks/tasks/:id/stats` | 任务统计（提交数、去重学生数、top tags）。 |
| GET | `/api/learning-tasks/tasks/:id/reports/common-issues` | common-issues 报表（topTags/topTypes/examples）；统计基于任务关联提交。 |

## AI Feedback Debug / Ops（门禁接口）

门禁条件：
- 全局 `SessionAuthGuard`（非 `@Public` 路由必须登录）
- 路由显式 `AiFeedbackDebugEnabledGuard + RolesGuard`
- `AI_FEEDBACK_DEBUG_ENABLED !== 'true'` 时返回 404（优先于 403）。

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/learning-tasks/ai-feedback/jobs` | 查询 job 队列状态（含失败与重试视角）。 |
| POST | `/api/learning-tasks/ai-feedback/jobs/process-once` | 手动执行一次处理批次（用于调试/运维）。 |

## 聚合口径特别说明

- 教师看板：`/api/classrooms/:id/dashboard` 的任务维度统计按 `classroomTaskId` 聚合。
- 学生看板：`/api/classrooms/mine/dashboard` 的 `myLatestSubmission` 及 `aiFeedbackStatus` 也按 `classroomTaskId` 隔离。
- 报表接口：`/api/learning-tasks/tasks/:id/reports/common-issues` 按 `taskId` 汇总反馈，但班级隔离分析依赖 `submission.classroomTaskId` 可扩展。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` 统计严格按 `classroomTaskId` 隔离（jobs 与 feedback 均不跨班汇总）。
