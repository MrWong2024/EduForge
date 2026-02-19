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
| GET | `/api/courses/:courseId/overview` | 课程总览（AB）。 |
| POST | `/api/courses/:id/archive` | 归档课程。 |

Notes:
- `/api/courses/:courseId/overview` Query: `window, sort, order, page, limit`。
- 权限：teacher only，且 `course.createdBy === currentUserId`；仅统计该 teacher 名下 classrooms。
- 聚合口径：按 `classroomId + classroomTaskId` 隔离；`studentsCount` 来自 Enrollment（`role=STUDENT,status=ACTIVE`）。

## Classrooms

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms` | 教师创建班级并分配 `joinCode`。 |
| PATCH | `/api/classrooms/:id` | 教师更新班级。 |
| GET | `/api/classrooms` | 教师分页查询班级。 |
| POST | `/api/classrooms/join` | 学生通过 `joinCode` 入班。 |
| GET | `/api/classrooms/mine/dashboard` | 学生学习看板（按 `classroomTaskId` 聚合个人提交与 AI 状态）。 |
| GET | `/api/classrooms/:id/dashboard` | 教师班级看板（按 `classroomTaskId` 聚合提交/AI 状态/tags）。 |
| GET | `/api/classrooms/:classroomId/weekly-report` | 班级周报（AA）。 |
| GET | `/api/classrooms/:classroomId/process-assessment` | 过程性评价（Z6）。 |
| GET | `/api/classrooms/:classroomId/process-assessment.csv` | 过程性评价 CSV（Z6）。 |
| GET | `/api/classrooms/:classroomId/export/snapshot` | 教学数据快照导出（Z9）。 |
| GET | `/api/classrooms/:id` | 获取班级详情（teacher owner 或 student member）。 |
| POST | `/api/classrooms/:id/archive` | 教师归档班级。 |
| POST | `/api/classrooms/:id/students/:uid/remove` | 教师移除学生。 |

Notes:
- `/api/classrooms/:classroomId/weekly-report` Query: `window, includeRiskStudentIds`。
- `/api/classrooms/:classroomId/weekly-report` 权限：teacher only，`classroom.teacherId === currentUserId`；统计隔离按 `classroomId + classroomTaskId`，`studentsCount/risk` 仅基于 Enrollment ACTIVE。
- `/api/classrooms/:classroomId/process-assessment` Query: `window, page, limit, sort, order`；teacher only；Enrollment-only；返回聚合结果，不返回敏感字段。
- `/api/classrooms/:classroomId/process-assessment.csv` Query: `window`；teacher only；CSV 为手写转义（双引号转义）；不返回敏感字段。
- `/api/classrooms/:classroomId/export/snapshot` Query: `window, limitStudents, limitAssessment, includePerTask`；teacher only；体积保护采用 limit 截断并在 `meta.notes` 写明；不返回敏感字段。

## Classroom Tasks（Classrooms 子资源）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms/:id/tasks` | 教师将已发布 Task 发布到班级（生成 ClassroomTask 实例）。 |
| GET | `/api/classrooms/:id/tasks` | 教师/学生查看班级任务列表。 |
| GET | `/api/classrooms/:id/tasks/:classroomTaskId` | 教师/学生查看班级任务详情。 |
| POST | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 班级发布实例提交入口（绑定 `classroomTaskId`）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail` | 学生端任务聚合详情（Z3）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory` | 学习轨迹（Z4）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack` | 课堂复盘包（Z5）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` | AI 运行指标报表（AI）。 |

Notes:
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：若 `dueAt` 存在且 `allowLate=false` 且 `now>dueAt`，拒绝（403），`error code = LATE_SUBMISSION_NOT_ALLOWED`；Submission 响应包含 `submittedAt/isLate/lateBySeconds` 语义字段。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`：student only，且必须 Enrollment ACTIVE；Query: `includeFeedbackItems, feedbackLimit`；`attemptNo>1` 在未手工 request 时可能 `NOT_REQUESTED`（无 job，合法语义）。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`：teacher only；Query: `window, page, limit, sort, order, includeAttempts, includeTagDetails`；学生范围取 Enrollment ACTIVE；未提交学生也会以 `notSubmitted` 维度出现在 `items`。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`：teacher only；Query: `window, topK, examplesPerTag, includeStudentTiers, includeTeacherScript`；禁止敏感字段，examples 不包含 `codeText/prompt/apiKey`。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`：Query `window, includeTags`；保留既有口径，统计严格按 `classroomTaskId` 隔离。

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
| POST | `/api/learning-tasks/submissions/:submissionId/ai-feedback/request` | 手工触发 AI 入队请求（幂等）。 |
| GET | `/api/learning-tasks/tasks/:id/stats` | 任务统计（提交数、去重学生数、top tags）。 |
| GET | `/api/learning-tasks/tasks/:id/reports/common-issues` | common-issues 报表（topTags/topTypes/examples）。 |

Notes:
- `/api/learning-tasks/submissions/:submissionId/ai-feedback/request` 是产品能力，不受 `AI_FEEDBACK_DEBUG_ENABLED` 门禁影响，但受登录 + RBAC + 资源归属校验。
- 幂等语义：job 已存在则返回既有 job（200）；不存在则创建 `PENDING` job。

## AI Feedback Debug / Ops（门禁接口）

门禁条件：
- 全局 `SessionAuthGuard`（非 `@Public` 路由必须登录）。
- 路由显式 `AiFeedbackDebugEnabledGuard + RolesGuard`。
- `AI_FEEDBACK_DEBUG_ENABLED !== 'true'` 时返回 404（优先于 403）。

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/learning-tasks/ai-feedback/jobs` | 查询 job 队列状态（含失败与重试视角）。 |
| POST | `/api/learning-tasks/ai-feedback/jobs/process-once` | 手动执行一次处理批次（用于调试/运维）。 |

## 聚合口径特别说明

- 教师看板：`/api/classrooms/:id/dashboard` 的任务维度统计按 `classroomTaskId` 聚合。
- 学生看板：`/api/classrooms/mine/dashboard` 的 `myLatestSubmission` 及 `aiFeedbackStatus` 按 `classroomTaskId` 隔离。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` 统计严格按 `classroomTaskId` 隔离（jobs 与 feedback 均不跨班汇总）。
- 成员权威来源：Enrollment-only（`role=STUDENT,status=ACTIVE`）；`classroom.studentIds` 不作为授权/统计来源。
- 隔离原则：课堂分析/报表/复盘/导出均按 `classroomTaskId` 隔离，禁止用 `taskId` 兜底做跨班聚合。
