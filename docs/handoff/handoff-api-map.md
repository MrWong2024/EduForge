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
| PATCH | `/api/users/me` | 更新当前会话用户公开资料（仅 `name/studentNo/employeeNo`）。 |
| POST | `/api/users/me/change-password` | 当前登录用户自助修改密码（需校验 `currentPassword`）。 |

Notes:
- `GET /api/users/me` 与 `PATCH /api/users/me` 返回口径一致（公开字段），不返回 `passwordHash`。
- `PATCH /api/users/me` 仅允许更新 `name/studentNo/employeeNo`，基于当前登录会话识别用户。
- `POST /api/users/me/change-password` 请求体：`currentPassword/newPassword`；`newPassword` 会执行 trim 非空、长度与“不得与当前密码相同”校验；改密成功后保留当前会话并失效该用户其它历史会话。

## Courses

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/courses` | 教师创建课程。 |
| PATCH | `/api/courses/:id` | 教师更新课程（含 `status` 归档/恢复）。 |
| DELETE | `/api/courses/:id` | 教师删除空课程（仅无班级引用时允许）。 |
| GET | `/api/courses` | 教师分页查询课程。 |
| GET | `/api/courses/:id` | 教师获取单课程详情。 |
| GET | `/api/courses/:courseId/overview` | 课程总览（AB）。 |
| POST | `/api/courses/:id/archive` | 归档课程。 |

Notes:
- `/api/courses/:courseId/overview` Query: `window, sort, order, page, limit`。
- `/api/courses/:courseId/overview` `limit` DTO 最大上限已从 `50` 调整为 `100`，默认 `limit=20` 保持不变；用于匹配前端课程总览页显式请求 `limit=100` 的稳定契约。
- `/api/courses/:courseId/overview` `sort` 兼容字段：`studentsCount/submissionRate/aiSuccessRate/pendingJobs/failedJobs`，并新增 `overallSubmissionCoverage`。
- `/api/courses/:courseId/overview` 窗口契约：默认 `window=all`；后端兼容集合为 `all/7d/24h/1h`（旧值继续兼容）。
- `/api/courses/:courseId/overview` 中 `window=all` 语义：课程总览口径下不拼时间下界（无 `createdAt >= lowerBound` 过滤）。
- 权限：teacher only，且 `course.createdBy === currentUserId`；仅统计该 teacher 名下 classrooms。
- 聚合口径：按 `classroomId + classroomTaskId` 隔离；`studentsCount` 来自 Enrollment（`role=STUDENT,status=ACTIVE`）。
- `items[*].submissionRate` 为兼容字段，语义保持 `distinctStudentsSubmitted / studentsCount`（至少提交过一次的学生覆盖率），不表示“班级全部已发布任务整体完成覆盖度”。
- `items[*].overallSubmissionCoverage` 为课程总览主比较指标：`sum(distinctStudentsSubmitted per classroomTask) / (studentsCount * publishedClassroomTasks)`；当 `studentsCount=0` 或 `publishedClassroomTasks=0` 返回 `0`。
- `items[*].ai.aiSuccessRate` 口径：`jobsTotal=0 -> null`；`jobsTotal>0 -> succeededJobs / jobsTotal`。
- `Course.courseLabel`：可选课程分类字段（与 `Task.courseLabel` 共用 `TASK_COURSE_LABELS`），用于“班级课程分类坐标”与模板课程分类对齐；非外键、可为空。
- 课程状态契约：`Course.status` 支持 `ACTIVE | ARCHIVED`；`PATCH /api/courses/:id` 可通过 body `status` 实现归档与恢复（`ARCHIVED <-> ACTIVE`）。
- 课程删除契约：`DELETE /api/courses/:id` 仅在“空课程”允许删除；空课程判定主规则是 `Classroom` 无记录（`Classroom.exists({ courseId }) === false`）。
- 非空课程删除错误：返回 `409 Conflict`，错误码 `COURSE_NOT_EMPTY`，message=`该课程下已有班级记录，不能删除，只能归档`。
- 兼容接口：保留 `POST /api/courses/:id/archive`，内部收口到统一状态更新链路。

## Classrooms

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms` | 教师创建班级并分配 `joinCode`。 |
| PATCH | `/api/classrooms/:id` | 教师更新班级（含 `status` 归档/恢复）。 |
| DELETE | `/api/classrooms/:id` | 教师删除空班级（仅无任务且无 enrollment 历史时允许）。 |
| GET | `/api/classrooms` | 教师分页查询班级。 |
| POST | `/api/classrooms/join` | 学生通过 `joinCode` 入班。 |
| GET | `/api/classrooms/mine/dashboard` | 学生学习看板（按 `classroomTaskId` 聚合个人提交与 AI 状态；Query `includeHistorical` 可回看当前 ACTIVE 班级下历史任务）。 |
| GET | `/api/classrooms/:id/dashboard` | 教师班级看板（按 `classroomTaskId` 聚合提交/AI 状态/tags；Query `includeClosedTasks` 可显式包含已关闭任务）。 |
| GET | `/api/classrooms/:classroomId/weekly-report` | 班级周报（AA）。 |
| GET | `/api/classrooms/:classroomId/process-assessment` | 过程性评价（Z6）。 |
| GET | `/api/classrooms/:classroomId/process-assessment.csv` | 过程性评价 CSV（Z6）。 |
| GET | `/api/classrooms/:classroomId/export/snapshot` | 教学数据快照导出（Z9）。 |
| GET | `/api/classrooms/:id` | 获取班级详情（teacher owner 或 student member）。 |
| GET | `/api/classrooms/:id/students` | 教师分页查看班级正式成员列表（默认 Enrollment ACTIVE；`includeRemoved=1/true` 可包含 REMOVED）。 |
| POST | `/api/classrooms/:id/archive` | 教师归档班级。 |
| POST | `/api/classrooms/:id/students/:uid/remove` | 教师移除学生。 |

Notes:
- `/api/classrooms/:classroomId/weekly-report` Query: `window, includeRiskStudentIds`。
- `/api/classrooms/:classroomId/weekly-report` 权限：teacher only，`classroom.teacherId === currentUserId`；统计隔离按 `classroomId + classroomTaskId`，`studentsCount/risk` 仅基于 Enrollment ACTIVE。
- `/api/classrooms/:classroomId/process-assessment` Query: `window, page, limit, sort, order`；teacher only；Enrollment-only；返回聚合结果，不返回敏感字段。
- `/api/classrooms/:classroomId/process-assessment.csv` Query: `window`；teacher only；CSV 为手写转义（双引号转义）；不返回敏感字段。
- `/api/classrooms/:classroomId/process-assessment` 响应项增强：`items[*]` 返回 `studentId/studentName/studentNo`；`studentName` 缺失回落 `未知学生`，`studentNo` 缺失返回 `null`。
- `/api/classrooms/:classroomId/process-assessment.csv` 与 JSON 口径对齐：新增 `studentName,studentNo` 列并保留 `studentId`，列顺序前置为 `studentName,studentNo,studentId,...`。
- `weekly-report` 窗口契约（后端阶段一）：默认 `window=all`；后端兼容集合为 `all/7d/30d/24h/1h`（`24h/1h` 为兼容窗口，不作为推荐默认窗口）。
- `process-assessment`（JSON + CSV）窗口契约（后端阶段一）：默认 `window=all`；后端兼容集合为 `all/7d/30d/term`（`term` 为兼容窗口）；`window=all` 语义与 JSON/CSV 完全一致。
- `window=all` 统一语义：在当前资源边界内做全量统计（班级级接口 = 当前班级可纳入口径的全部历史记录），实现为“无时间下界过滤”，不是固定 90/180 天。
- 前后端分层说明：本节记录的是“后端兼容支持集合”；前端当前展示项与默认值仍可能滞后，下一阶段前端再切换主展示策略。
- `/api/classrooms/:classroomId/export/snapshot` Query: `window, limitStudents, limitAssessment, includePerTask`；teacher only；体积保护采用 limit 截断并在 `meta.notes` 写明；不返回敏感字段。
- `/api/classrooms/:id/students`：teacher only + owner only（非 owner 返回 `404`）；成员来源只认 Enrollment（`role=STUDENT`）；默认只返回 `status=ACTIVE`，`includeRemoved=1/true` 时返回 `ACTIVE+REMOVED`；不读取/不回退 `classroom.studentIds`；默认排序 `joinedAt desc, _id desc`；不返回 `passwordHash`。
- `/api/classrooms/:id/dashboard`：teacher only + owner only；默认只返回 `classroomTask.status=ACTIVE` 的任务；`includeClosedTasks=true` 时返回 `ACTIVE+CLOSED`；`RECALLED/缺失/未知状态` 不返回；每个 task item 返回 `classroomTaskStatus`、关联模板状态 `taskTemplateStatus(DRAFT|PUBLISHED|ARCHIVED|null)` 与关联模板发布者摘要 `taskPublisher:{id,name?}|null`；教师看板不因模板非 `PUBLISHED` 过滤既有课堂任务实例；统计口径与返回任务集合一致；顶层返回 `archiveSuggestion`，仅作为“建议归档”提示，不会自动归档或修改班级状态。
- `/api/classrooms/mine/dashboard`：student only；默认只返回 `classroom.status=ACTIVE`、`classroomTask.status=ACTIVE` 且仍值得关注的任务；学生看板不再要求关联模板当前 `task.status=PUBLISHED`，模板变为 `ARCHIVED/DRAFT` 不影响既有 classroomTask 的可见性；有 `dueAt` 时截止后 30 天内仍显示并标记 `RECENTLY_EXPIRED`，超过 30 天为 `HISTORICAL` 且默认隐藏；无 `dueAt` 时 `publishedAt` 90 天内显示，超过 90 天为 `HISTORICAL` 且默认隐藏；`includeHistorical=true` 返回 `CURRENT+RECENTLY_EXPIRED+HISTORICAL`，但仍不返回归档班级或非 ACTIVE classroomTask；每个 item 的 `classroom` 现稳定返回 `teacher:{id,name,employeeNo}` 与 `course:{id,name,term,code}` 摘要：教师摘要仅含 id/姓名/工号，不返回 email；课程摘要仅含 id/课程名/学期/课程编号，不返回 `courseLabel/createdBy/status/createdAt/updatedAt`；关联记录缺失或文本字段空白时对应文本字段回落为 `null`；每个 task item 返回 `studentVisibilityStatus/isHistorical`，`total` 按最终返回班级分组统计。
- 班级状态契约：`Classroom.status` 支持 `ACTIVE | ARCHIVED`；`PATCH /api/classrooms/:id` 可通过 body `status` 实现归档与恢复（`ARCHIVED <-> ACTIVE`）。
- 班级响应契约：`ClassroomResponse` 继续保留 `courseId`，并新增只读 `course` 摘要对象（`id/code/name/term/courseLabel/status`）；课程记录缺失时允许 `course` 为空，但不得影响班级读取。
- 班级删除契约：`DELETE /api/classrooms/:id` 仅在“空班级”允许删除；空班级判定主规则是 `ClassroomTask` 无记录且 `Enrollment` 无记录（包含 `REMOVED` 历史）；`studentIds` 仅作防御性辅助校验。
- 非空班级删除错误：返回 `409 Conflict`，错误码 `CLASSROOM_NOT_EMPTY`，message=`该班级已有成员或任务记录，不能删除，只能归档`。

## Classroom Tasks（Classrooms 子资源）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/classrooms/:id/tasks` | 教师将已发布 Task 发布到班级（生成 ClassroomTask 实例）。 |
| GET | `/api/classrooms/:id/publishable-task-templates` | 班级发布候选模板分页查询（内置可见性/PUBLISHED/已发布去重规则）。 |
| GET | `/api/classrooms/:id/tasks` | 教师/学生查看班级任务列表。 |
| GET | `/api/classrooms/:id/tasks/:classroomTaskId` | 教师/学生查看班级任务详情。 |
| PATCH | `/api/classrooms/:classroomId/tasks/:classroomTaskId` | 教师更新课堂任务实例级发布参数（截止时间/迟交/尝试次数）。 |
| PATCH | `/api/classrooms/:classroomId/tasks/:classroomTaskId/status` | 教师更新课堂任务实例生命周期状态（关闭/撤回/恢复提交）。 |
| POST | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 班级发布实例提交入口（绑定 `classroomTaskId`）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 教师分页查看课堂任务实例提交列表（仅 `classroomTaskId`）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail` | 学生端任务聚合详情（Z3）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory` | 学习轨迹（Z4）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack` | 课堂复盘包（Z5）。 |
| GET | `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` | AI 运行指标报表（AI）。 |

Notes:
- `GET /api/classrooms/:id/publishable-task-templates`：teacher only + owner only（非 owner 返回 `404`）；固定只返回 `status=PUBLISHED` 且当前教师可见模板（自己私有 + 自己共享 + 他人共享）；自动排除当前班级已发布过的 `taskId`；支持 query `courseLabel, onlyMine, knowledgeModule, stage, page, limit`；当请求未显式传 `courseLabel` 且当前班级课程存在 `courseLabel` 时，排序优先课程分类匹配模板，再按 `updatedAt desc, createdAt desc`；每个 item 返回 `publisher:{id,name?}|null`，表示候选模板创建者/发布者摘要，只含 `id/name`，不暴露完整 User。
- 索引口径：`Task` 已补发布候选查询复合索引（`onlyMine` 分支与共享可见分支各一组），用于支撑 `status/courseLabel/knowledgeModule/stage + updatedAt/createdAt` 的组合过滤与排序。
- `ClassroomTask.status` 生命周期：`ACTIVE | CLOSED | RECALLED`；新发布默认 `ACTIVE`；允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`；其中撤回要求“无提交”。
- `PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId`：teacher only + owner only；仅允许更新实例级字段 `dueAt/settings.allowLate/settings.maxAttempts`；`status` 仍走独立 `/status` 接口；状态边界为 `ACTIVE/CLOSED` 可编辑、`RECALLED` 不可编辑。
- `PATCH /api/classrooms/:classroomId/tasks/:classroomTaskId/status`：teacher only + owner only；`status` 入参允许 `ACTIVE/CLOSED/RECALLED`，但流转受后端状态机约束：允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`，拒绝 `RECALLED` 相关恢复/再次流转与 `CLOSED -> RECALLED`；当目标为 `RECALLED` 且已有提交时返回 `400`（提示只能关闭）。
- `CLOSED -> ACTIVE` 仅恢复提交状态，不会自动修改 `dueAt/settings.allowLate/settings.maxAttempts`；若需延长期限或修改规则，仍需调用实例配置更新接口。
- 课堂任务返回口径（列表/详情/my-task-detail 的 `classroomTask` 区块）已补 `status` 字段；旧数据缺省状态按 `ACTIVE` 兼容输出。
- `GET /api/classrooms/:id/tasks` 列表与详情 item 返回关联模板发布者摘要 `taskPublisher:{id,name?}|null`，来源为底层 `Task.createdBy` 用户，只含 `id/name`，不暴露完整 User。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：提交前先校验 `classroom.status=ACTIVE`、`ClassroomTask.status=ACTIVE` 与 `Enrollment ACTIVE`；学生提交不再要求关联模板当前 `task.status=PUBLISHED`，模板变为 `ARCHIVED` 不拒绝既有 classroomTask 提交；此外若 `dueAt` 存在且 `allowLate=false` 且 `now>dueAt`，拒绝（403），`error code = LATE_SUBMISSION_NOT_ALLOWED`；Submission 响应包含 `submittedAt/isLate/lateBySeconds` 语义字段。
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：teacher only + owner only（非 owner 返回 `404`）；只按 `classroomTaskId` 分页查询，禁止按 `taskId` 跨班聚合；默认排序 `submittedAt desc, _id desc`；`aiFeedbackStatus` 无 job 时为 `NOT_REQUESTED`；`items[*].feedbackCount` 为该 submission 在 Feedback 集合中的总条数（按当前页 submissionIds 批量聚合），无反馈时返回 `0`；不返回 `passwordHash`、`content.codeText`。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`：student only，且必须 Enrollment ACTIVE；Query: `includeFeedbackItems, feedbackLimit`；响应顶层返回 `participationStatus`（`readOnly/canSubmit/canRequestAiFeedback/reason/message`），作为状态层只读信号；学生端运行态不再由模板当前状态决定，原因优先级现为 `CLASSROOM_NOT_ACTIVE > CLASSROOM_TASK_NOT_ACTIVE > ACTIVE`；`classroom.status/classroomTask.status/task.status` 仍稳定返回，但 `task.status` 仅作模板信息展示；`participationStatus` 不混入 `dueAt/allowLate/cooldown/NOT_REQUESTED` 等动作级规则；`attemptNo>1` 在未手工 request 时可能 `NOT_REQUESTED`（无 job，合法语义）。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`：teacher only；Query: `window, page, limit, sort, order, includeAttempts, includeTagDetails`；默认 `window=all`，默认 `limit=20` 不变；后端兼容集合 `all/7d/24h/30d`（`24h/30d` 为兼容窗口，下一阶段前端不再主展示）；`limit` DTO / service 最大上限已从 `50` 提升到 `100`，用于下一阶段前端默认每页 `100` 的稳定契约；`window=all` = 该课堂任务口径下无时间下界过滤；学生范围取 Enrollment ACTIVE；`items[*]` 返回结构化学生公开信息 `student:{id,name,studentNo,email}`（并兼容回填 `studentName`）；未提交学生也会以 `notSubmitted` 维度出现在 `items`；`includeAttempts=true` 时 `items[*].attempts[*].feedbackCount` 返回该 submission 在 Feedback 集合中的总条数（AI/TEACHER/SYSTEM 全来源，按当前页 submissionIds 批量聚合）；`feedbackSummary.totalItems` 仍保留 AI 摘要语义。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`：teacher only；Query: `window, topK, examplesPerTag`；默认 `window=all`；后端兼容集合 `all/7d/24h/30d`（`24h/30d` 为兼容窗口，下一阶段前端不再主展示）；`window=all` = 该课堂任务口径下无时间下界过滤；禁止敏感字段，examples 不包含 `codeText/prompt/apiKey`；`examples` 现为去重后的典型样例池（以 `feedbackId` 去重），每项含 `feedbackId/submissionId/attemptNo/severity/type/message/suggestion/source/primaryTag/matchedTags/tags`；`topTags` 继续按标签展开计数（多标签 feedback 会同时贡献多个 tag 计数）；`studentTiers` 固定返回，且基于 Enrollment ACTIVE + 窗口内 `submission.createdAt`，按每个学生最新提交分层（`good=Succeeded 且 latestErrorCount=0`，`watch=其余已提交`，`notSubmitted=窗口内无提交`，其中 `latestErrorCount` 仅统计该最新提交下 `source=AI && severity=ERROR`）；`studentTiers.*[*]` 统一包含 `studentId/studentName/studentNo`（`studentName` 缺失时回落为 `未知学生`）。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`：Query `window, includeTags`；保留既有口径（仅 `1h/24h/7d`），统计严格按 `classroomTaskId` 隔离；本轮未引入 `all`。

## Learning Tasks

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/learning-tasks/tasks` | 创建任务。 |
| PATCH | `/api/learning-tasks/tasks/:id` | 更新任务。 |
| POST | `/api/learning-tasks/tasks/:id/publish` | 发布任务。 |
| POST | `/api/learning-tasks/tasks/:id/archive` | 将作者自己的已发布任务模板归档。 |
| POST | `/api/learning-tasks/tasks/:id/restore` | 兼容保留入口；稳定返回 400，不再恢复归档模板。 |
| GET | `/api/learning-tasks/tasks` | 分页查询任务。 |
| GET | `/api/learning-tasks/tasks/:id` | 任务详情。 |
| POST | `/api/learning-tasks/tasks/:id/submissions` | 通用任务提交入口（可无 `classroomTaskId`）。 |
| GET | `/api/learning-tasks/tasks/:id/submissions/mine` | 学生查看自己的提交与 `aiFeedbackStatus`。 |
| GET | `/api/learning-tasks/tasks/:id/submissions` | 教师分页查看某任务提交。 |
| GET | `/api/learning-tasks/submissions/:id` | 提交详情稳定读源（学生本人或有权教师可见）。 |
| POST | `/api/learning-tasks/submissions/:id/feedback` | 教师新增反馈（AI/TEACHER/SYSTEM 结构统一）。 |
| PATCH | `/api/learning-tasks/submissions/:submissionId/feedback/:feedbackId` | 教师修改自己有权管理的 TEACHER 来源反馈。 |
| GET | `/api/learning-tasks/submissions/:id/feedback` | 提交反馈列表（学生本人或任务教师可见）。 |
| POST | `/api/learning-tasks/submissions/:submissionId/ai-feedback/request` | 手工触发 AI 入队请求（幂等）。 |
| GET | `/api/learning-tasks/tasks/:id/stats` | 任务统计（提交数、去重学生数、top tags）。 |
| GET | `/api/learning-tasks/tasks/:id/reports/common-issues` | common-issues 报表（topTags/topTypes/examples）。 |

Notes:
- `Task.courseLabel`：可选字符串字段（单选课程分类），白名单来源 `backend/src/modules/learning-tasks/task-course-labels.constants.ts`；非 `Course` 外键，不参与权限与发布约束，不限制跨课程复用。
- `Task.visibility`：模板可见性字段，值域 `PRIVATE | SHARED`（白名单来源 `backend/src/modules/learning-tasks/task-template-visibility.constants.ts`）；新建默认 `PRIVATE`；该字段只影响“读可见性”，不改变作者权限边界。
- `POST/PATCH/GET /api/learning-tasks/tasks*`：入参与出参已支持 `courseLabel` 与 `visibility`；旧任务缺省 `visibility` 兼容按 `SHARED` 处理。
- `GET /api/learning-tasks/tasks` 与 `GET /api/learning-tasks/tasks/:id` 返回任务模板发布者摘要 `publisher:{id,name?}|null`，来源为 `Task.createdBy` 用户，只含 `id/name`；前端可用 `currentUser.id !== publisher.id` 决定是否显示来源。
- 任务模板生命周期已收口为单向流转：创建时仅允许初始 `status=DRAFT|PUBLISHED`（未传时默认 `DRAFT`），且禁止创建 `ARCHIVED`；创建成功后只允许 `DRAFT -> PUBLISHED -> ARCHIVED`。
- `PATCH /api/learning-tasks/tasks/:id`：只负责内容编辑，不再承载状态生命周期变更；如果请求体包含 `status` 且值与当前状态不同，返回 `400 Task template status must be changed through lifecycle actions`；如果 `status` 与当前状态相同，后端忽略该字段并继续处理其它可编辑字段；`ARCHIVED` 模板普通内容更新仍返回 `400 Archived tasks cannot be updated`。
- `POST /api/learning-tasks/tasks/:id/publish`：teacher only；仅任务作者可调用；只允许 `DRAFT -> PUBLISHED`；当前已是 `PUBLISHED` 时保持幂等返回当前任务；当前是 `ARCHIVED` 时返回 `400 Archived task templates cannot be published`。
- `POST /api/learning-tasks/tasks/:id/archive`：teacher only；仅任务作者可调用；只允许 `PUBLISHED -> ARCHIVED`；`DRAFT/ARCHIVED` 均返回 `400 Only published task templates can be archived`；即使该模板已被 `ClassroomTask` 引用也允许归档，且不影响已发布 classroomTask 运行。
- `POST /api/learning-tasks/tasks/:id/restore`：teacher only；仅任务作者可调用；兼容保留但不再作为正常业务能力，稳定返回 `400 Archived task templates cannot be restored to draft; clone as draft instead`；后续若需复用归档模板，应走“复制为新草稿”新能力。
- `GET /api/learning-tasks/tasks` Query：`scope, status, knowledgeModule, courseLabel, stage, page, limit, createdBy`；默认 `scope=mine`（不再默认公共池）；`courseLabel=未分类` 时兼容匹配字段缺省任务。
- `GET /api/learning-tasks/tasks` 中 `status/knowledgeModule/stage` 已在 `listTasks` 内进入数据库级过滤（与 `scope/courseLabel` 叠加生效）。
- 前端任务模板页当前若仍使用本地 `status/knowledgeModule/stage` 过滤，仅代表前端接入阶段尚未切换；后端查询契约已完成升级。
- `scope` 语义：
  - `mine`：仅当前教师自己的模板（`PRIVATE + SHARED`）。
  - `shared`：共享池（`visibility=SHARED` + 旧数据缺省 `visibility`），包含“我自己设为 SHARED 的模板”。
  - `all`：当前教师可见全集（我的全部 + 共享池）。
- `createdBy`：仅保留兼容字段；当前列表语义以 `scope` 为主，不再作为越权筛选入口。
- `GET /api/learning-tasks/tasks/:id`：可见性规则为“作者本人可读；他人仅可读 `SHARED`（含旧数据缺省兼容视为 `SHARED`）；他人 `PRIVATE` 不可读（404）”。
- `/api/learning-tasks/submissions/:submissionId/ai-feedback/request` 是产品能力，不受 `AI_FEEDBACK_DEBUG_ENABLED` 门禁影响，但受登录 + RBAC + 资源归属校验；学生对本人课堂任务 submission 手工请求 AI 前仍需满足 `classroom.status=ACTIVE`、`ClassroomTask.status=ACTIVE`，但不再要求模板当前 `task.status=PUBLISHED`，模板变为 `ARCHIVED` 不影响既有课堂任务的 AI 请求。
- 幂等语义：job 已存在则返回既有 job（200）；不存在则创建 `PENDING` job。
- `GET /api/learning-tasks/submissions/:id` 权限：学生本人可读；若 `classroomTaskId` 存在，仅该 `classroomTask` 所属班级 owner teacher 可读；若 `classroomTaskId` 为空，仅 `task.createdBy` 对应的 task owner teacher 可读；其他用户返回 `403`；submission 不存在返回 `404`。
- `GET /api/learning-tasks/submissions/:id` 返回稳定读源字段：`id/taskId/classroomTaskId/studentId/studentName/taskTitle/content.language/content.codeText/submittedAt/attemptNo/isLate/lateBySeconds/aiFeedbackStatus`；不返回 `passwordHash`。
- `aiFeedbackStatus` 口径：无 job 时显式返回 `NOT_REQUESTED`；`GET /api/learning-tasks/submissions/:id` 允许返回 `content.codeText`，但 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 列表接口仍不返回 `content.codeText`。
- `PATCH /api/learning-tasks/submissions/:submissionId/feedback/:feedbackId`：teacher only；若 submission 绑定 `classroomTaskId`，仅课堂任务所属班级 owner teacher 可改；未绑定课堂任务时仅 task owner teacher 可改；feedback 不存在或不属于该 submission 返回 `404`；仅允许修改 `source=TEACHER` 的反馈，`AI/SYSTEM` 返回 `403 Only teacher feedback can be updated`；返回单条 feedback response，含 `createdBy/createdAt/updatedAt`。
- Feedback response 统一返回字段：`id/submissionId/source/type/severity/message/suggestion/tags/scoreHint/createdAt/updatedAt`，教师创建或更新后可返回 `createdBy`；旧数据缺失 `createdBy` 时兼容为缺省。

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

- 教师看板：`/api/classrooms/:id/dashboard` 的任务维度统计按 `classroomTaskId` 聚合；默认仅统计返回的 `ACTIVE` classroomTask，`includeClosedTasks=true` 时统计返回的 `ACTIVE+CLOSED` 集合。
- 教师看板 task item 的 `taskTemplateStatus` 表示关联模板当前状态；`taskPublisher` 表示关联模板创建者/发布者摘要。前端可仅对 `DRAFT/ARCHIVED` 显示异常标签，`PUBLISHED` 不显示；可仅对非本人模板显示发布者姓名。学生看板、学生详情、学生提交与学生课堂任务 AI 请求均不再要求模板当前 `task.status=PUBLISHED`。
- 学生看板：`/api/classrooms/mine/dashboard` 的 `classroom.teacher` 为班级级教师摘要（`id/name/employeeNo`，无 email；教师记录缺失时保留 `teacher.id` 并把文本字段回落为 `null`）；`classroom.course` 为班级级课程摘要（`id/name/term/code`；课程记录缺失时保留 `course.id` 并把文本字段回落为 `null`，不返回 `courseLabel/createdBy/status/createdAt/updatedAt`）；`myLatestSubmission`、`aiFeedbackStatus` 与 `completionStatus` 只围绕最终返回的 `classroomTaskId` 计算；默认隐藏归档班级、非 ACTIVE classroomTask 与长期历史任务，`includeHistorical=true` 仅放开时间窗口，不放开班级/课堂任务状态边界。
- `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` 统计严格按 `classroomTaskId` 隔离（jobs 与 feedback 均不跨班汇总）。
- 成员权威来源：Enrollment-only（`role=STUDENT,status=ACTIVE`）；`classroom.studentIds` 不作为授权/统计来源。
- 隔离原则：课堂分析/报表/复盘/导出均按 `classroomTaskId` 隔离，禁止用 `taskId` 兜底做跨班聚合。
