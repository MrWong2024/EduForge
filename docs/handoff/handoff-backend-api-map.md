# 接口地图（Controller Scan）

## Scope / Owner

本文是公开 HTTP endpoint inventory 与 endpoint-level contract 的 Owner，回答“接口在哪里、谁能调用、对外做什么”。源码是最高事实源；下文 runtime Path 保留统一 `/api` 前缀。

- 本文拥有 Method/Path、endpoint purpose、Controller-level authentication / authorization、ownership、资源边界、生命周期、业务/HTTP 错误、可见副作用与必要的高层兼容语义。
- Query 字段、validation/transform/default、完整 response/nested shape、enum/nullability 和 safe exposure 由 [DTO / Public Data Contract Cheatsheet](./handoff-backend-dto-cheatsheet.md) 唯一维护。
- 内部配对、查询、排序、聚合公式、比率分母与计算、索引及性能策略见 [Service Map](./handoff-backend-service-map.md)；配置参数见 [Config Matrix](./handoff-backend-config-matrix.md)。
- frontend consumption 与 BFF 见 [Frontend API Map](./handoff-frontend-api-map.md)；testing/evidence 见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 和 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。

## 全局认证与授权口径

- 认证使用服务端 Session + HttpOnly Cookie，Cookie 名称 `ef_session`。登录创建服务端 session 并写 Cookie；注销清除 Cookie 并使该 session 失效。
- 当前用户探针固定为 `GET /api/users/me`，用于确认 Cookie session 与当前用户身份已建立；公开数据见 [DTO Users](./handoff-backend-dto-cheatsheet.md#users)。
- 全局 `SessionAuthGuard` 通过 `APP_GUARD` 保护非 `@Public()` 路由；公开例外包括登录、忘记密码、重置密码等显式 Public 路由。
- `RolesGuard` 由 Controller 显式启用；Service 继续执行资源归属校验，前端 role gate 仅承担体验层入口约束，不能替代后端授权。
- `TEACHER` 管理自己创建/拥有的课程、班级、课堂任务、提交与报表；`STUDENT` 仅访问自己 Enrollment ACTIVE 的班级任务、自己的提交与反馈。
- 成员与默认教学统计的权威来源为 Enrollment-only（`role=STUDENT,status=ACTIVE`）；`classroom.studentIds` 仅 legacy 镜像，不作为授权、统计或 fallback。
- 课堂分析、报表、复盘、导出以及课堂提交读取均按 `classroomId + classroomTaskId + studentId` 的资源边界隔离；禁止使用模板 `taskId` 兜底跨班聚合。通用模板入口的独立语义见 Learning Tasks。
- 认证失败返回 `401 Unauthorized`；debug/ops 门禁关闭时优先返回 `404`，不暴露入口存在性。

## App

| Method | Path   | 用途                            |
| ------ | ------ | ------------------------------- |
| GET    | `/api` | 基础连通性返回（Hello World）。 |

## Auth

| Method | Path                        | 用途                                                       |
| ------ | --------------------------- | ---------------------------------------------------------- |
| POST   | `/api/auth/login`           | 登录并写入 `ef_session` Cookie（HttpOnly）。               |
| POST   | `/api/auth/logout`          | 注销并清除 `ef_session` Cookie。                           |
| POST   | `/api/auth/forgot-password` | 提交邮箱并触发一次性密码重置邮件（固定返回通用成功提示）。 |
| POST   | `/api/auth/reset-password`  | 使用一次性 token 设置新密码，并清理该用户全部 sessions。   |

Notes:

- 忘记密码与重置密码是公开入口。忘记密码对邮箱不存在、不可登录用户及正常请求统一返回通用成功提示，避免枚举；只有允许登录的用户才创建 token 并触发邮件。
- 同一真实用户邮箱 60 秒内再次请求命中冷却时，不创建新 token、不失效旧 token、不重复发邮件，对外响应不变；邮件发送失败也维持通用提示。
- 重置使用一次性 token；无效、已使用、过期或对应用户不可登录时返回 `400 Reset token is invalid`。成功后该用户的重置凭据失效并清理全部 sessions；不会自动登录或写入登录 Cookie。
- 请求校验、公开 message 及凭据省略见 [DTO Auth](./handoff-backend-dto-cheatsheet.md#auth)；token 领取、失效与恢复策略见 [Service Card 01C](./handoff-backend-service-map.md#service-card-01c)。

## Users

| Method | Path                            | 用途                                                         |
| ------ | ------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/users/me`                 | 读取当前会话用户公开信息。                                   |
| PATCH  | `/api/users/me`                 | 更新当前会话用户公开资料（仅 `name/studentNo/employeeNo`）。 |
| POST   | `/api/users/me/change-password` | 当前登录用户自助修改密码（需校验 `currentPassword`）。       |

Notes:

- 读取与修改资料都基于当前登录会话，不接受替其他用户修改资料；公开资料白名单与相同返回投影见 [DTO Users](./handoff-backend-dto-cheatsheet.md#users)。
- 自助改密先校验当前密码；成功后保留当前会话，失效该用户其它历史会话。内部协作见 [Service Card 02](./handoff-backend-service-map.md#service-card-02)。

## Courses

| Method | Path                              | 用途                                    |
| ------ | --------------------------------- | --------------------------------------- |
| POST   | `/api/courses`                    | 教师创建课程。                          |
| PATCH  | `/api/courses/:id`                | 教师更新课程（含 `status` 归档/恢复）。 |
| DELETE | `/api/courses/:id`                | 教师删除空课程（仅无班级引用时允许）。  |
| GET    | `/api/courses`                    | 教师分页查询课程。                      |
| GET    | `/api/courses/:id`                | 教师获取单课程详情。                    |
| GET    | `/api/courses/:courseId/overview` | 课程总览（AB）。                        |
| POST   | `/api/courses/:id/archive`        | 归档课程。                              |

Notes:

- teacher only；资源必须由当前教师创建，课程总览仅涵盖该教师名下班级，并遵守全局 Enrollment-only 与课堂任务隔离边界。
- 总览是当前课程口径下的提交覆盖与 AI 运行概览，支持无时间下界的历史读取；各窗口、兼容提交率与整体覆盖率的区别见 [DTO 课程总览](./handoff-backend-dto-cheatsheet.md#课程总览)，聚合见 [Service Card 08C](./handoff-backend-service-map.md#service-card-08c)。
- 课程状态为 `ACTIVE | ARCHIVED`；PATCH 支持归档与恢复。已归档课程可通过状态更新恢复，但不允许普通内容编辑。
- 仅无任何班级引用的空课程可删除；非空时返回 `409 Conflict`，`code=COURSE_NOT_EMPTY`，message=`该课程下已有班级记录，不能删除，只能归档`。
- 兼容保留 POST archive，收口到相同归档行为；引用检查与内部一致性见 [Service Card 03](./handoff-backend-service-map.md#service-card-03)。课程分类是对齐坐标，不构成外键或额外权限边界；字段与返回数据见 [DTO Courses](./handoff-backend-dto-cheatsheet.md#courses)。

## Classrooms

| Method | Path                                                  | 用途                                                                                                                      |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/classrooms`                                     | 教师创建班级并分配 `joinCode`。                                                                                           |
| PATCH  | `/api/classrooms/:id`                                 | 教师更新班级（含 `status` 归档/恢复）。                                                                                   |
| DELETE | `/api/classrooms/:id`                                 | 教师删除空班级（仅无任务且无 enrollment 历史时允许）。                                                                    |
| GET    | `/api/classrooms`                                     | 教师分页查询班级。                                                                                                        |
| POST   | `/api/classrooms/join`                                | 学生通过 `joinCode` 入班。                                                                                                |
| GET    | `/api/classrooms/mine/dashboard`                      | 学生学习看板（按 `classroomTaskId` 聚合个人提交与 AI 状态；Query `includeHistorical` 可回看当前 ACTIVE 班级下历史任务）。 |
| GET    | `/api/classrooms/:id/dashboard`                       | 教师班级看板（按 `classroomTaskId` 聚合提交/AI 状态/tags；Query `includeClosedTasks` 可显式包含已关闭任务）。             |
| GET    | `/api/classrooms/:classroomId/weekly-report`          | 班级周报（AA）。                                                                                                          |
| GET    | `/api/classrooms/:classroomId/process-assessment`     | 过程性评价（Z6）。                                                                                                        |
| GET    | `/api/classrooms/:classroomId/process-assessment.csv` | 过程性评价 CSV（Z6）。                                                                                                    |
| GET    | `/api/classrooms/:classroomId/ai-learning-analytics`  | AI 反馈介入成效分析：班级总览与课堂任务趋势。                                                                             |
| GET    | `/api/classrooms/:classroomId/ai-learning-analytics/students` | AI 反馈介入成效分析：ACTIVE 学生分页列表。                                                                         |
| GET    | `/api/classrooms/:classroomId/ai-learning-analytics/students/:studentId` | AI 反馈介入成效分析：单个 ACTIVE 学生详情与全任务点。                                                       |
| GET    | `/api/classrooms/:classroomId/export/snapshot`        | 教学数据快照导出（Z9）。                                                                                                  |
| GET    | `/api/classrooms/:id`                                 | 获取班级详情（teacher owner 或 student member）。                                                                         |
| GET    | `/api/classrooms/:id/students`                        | 教师分页查看班级正式成员列表（默认 Enrollment ACTIVE；`includeRemoved=1/true` 可包含 REMOVED）。                          |
| POST   | `/api/classrooms/:id/archive`                         | 教师归档班级。                                                                                                            |
| POST   | `/api/classrooms/:id/students/:uid/remove`            | 教师移除学生。                                                                                                            |

Notes:

- 教师管理与报表入口要求 teacher owner；班级详情允许 owner teacher 或当前正式学生成员。成员权威来源为 Enrollment，不回退 legacy studentIds。
- 正式成员列表仅 owner teacher 可读，非 owner 返回 `404`；默认 ACTIVE，显式包含移除成员时返回 ACTIVE + REMOVED 历史。数据及选项解析见 [DTO Classroom family](./handoff-backend-dto-cheatsheet.md#classrooms)，默认成员排序和读取策略见 [Service Card 04](./handoff-backend-service-map.md#service-card-04)。
- 教师看板默认仅返回 ACTIVE 课堂任务；显式包含关闭任务时返回 ACTIVE + CLOSED；RECALLED、缺失或未知实例状态不返回。既有实例不因关联模板非 PUBLISHED 而消失。统计范围与返回任务集合一致，默认排除 REMOVED 学生历史提交贡献；归档建议只作提示，不自动改变班级状态。
- 学生看板要求当前 Enrollment ACTIVE，默认只展示 ACTIVE 班级内 ACTIVE 课堂任务。模板变为 ARCHIVED/DRAFT 不影响既有实例可见性。有截止时间的任务在截止后 30 天内仍显示为近期过期，更早的归为历史；无截止时间的任务在发布后 90 天内显示，更早的归为历史。includeHistorical 仅放开时间窗口，不放开班级或课堂任务状态边界。
- 看板的状态字段、公开摘要及缺失关联兼容见 [DTO Dashboard / Student state](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family)；归档建议与任务筛选计算分别见 [Service Card 05](./handoff-backend-service-map.md#service-card-05) / [06](./handoff-backend-service-map.md#service-card-06)。
- Weekly report 是 teacher owner 的班级进度/风险/AI 概览，学生范围为当前 Enrollment ACTIVE；窗口与公开数据见 [DTO Weekly report](./handoff-backend-dto-cheatsheet.md#weekly-report)，内部计算见 [Service Card 08B](./handoff-backend-service-map.md#service-card-08b)。
- Process Assessment JSON / CSV 均为 teacher owner 的过程性指标，不能作为正式成绩仲裁；二者使用相同窗口、排除项与查询口径，CSV 媒体类型为 `text/csv; charset=utf-8`。临时任务排除只改变本次分析，不修改教学数据；零提交及排除全部任务时仍返回当前 ACTIVE 学生。
- PA 的合法窗口、term 旧链接兼容、零值、rubric 及 CSV 数据合同见 [DTO Process Assessment](./handoff-backend-dto-cheatsheet.md#process-assessment)；评分、risk 与排除重算见 [Service Card 08G](./handoff-backend-service-map.md#service-card-08g)。
- AI Learning Analytics 三个入口统一 teacher only + classroom owner only；课堂不存在或非 owner 返回 `404 Classroom not found`。学生详情仅允许当前课堂 ACTIVE Enrollment 学生，REMOVED、外班及非法学生 id 均安全返回 `404`。
- Analytics 以课堂任务发布时间界定分析任务范围，呈现 AI 反馈介入后的班级、任务与学生结果。学生列表的 q 只匹配姓名/学号，不区分大小写，按字符串子串匹配；q、overallOutcome 与 engagementStatus 采用 AND 组合。非法 Query 按 DTO 校验拒绝（`400`）。公开参数/分页结果、方法学 V1.1、枚举与零值见 [DTO Analytics](./handoff-backend-dto-cheatsheet.md#ai-learning-analytics)，配对与搜索筛选分页算法见 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i)。
- Analytics 仅反映 EduForge AI 反馈介入后的提交行为及代码问题代理变化，不覆盖全部 AI 使用，不是正式成绩、学习能力或因果贡献结论，也不能证明学生已阅读/采纳反馈。净结果不代表时间序列趋势；反馈阶段不表示态度、AI 依赖、能力或风险。
- Snapshot 是 teacher owner 的体积受控教学数据快照导出，超量数据附带截断提示；Query、meta/notes、公开投影与敏感省略见 [DTO Snapshot](./handoff-backend-dto-cheatsheet.md#classroom-export-snapshot)，组合与截断策略见 [Service Card 08H](./handoff-backend-service-map.md#service-card-08h)。
- 班级状态为 `ACTIVE | ARCHIVED`，PATCH 支持归档/恢复，保留 POST archive。仅无 ClassroomTask 且无 Enrollment 记录（包含 REMOVED 历史）的空班级可删除；legacy studentIds 仅作删除防御校验。非空时返回 `409 Conflict`，`code=CLASSROOM_NOT_EMPTY`，message=`该班级已有成员或任务记录，不能删除，只能归档`。

## Classroom Tasks（Classrooms 子资源）

| Method | Path                                                                      | 用途                                                              |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/classrooms/:id/tasks`                                               | 教师将已发布 Task 发布到班级（生成 ClassroomTask 实例）。         |
| GET    | `/api/classrooms/:id/publishable-task-templates`                          | 班级发布候选模板分页查询（内置可见性/PUBLISHED/已发布去重规则）。 |
| GET    | `/api/classrooms/:id/tasks`                                               | 教师/学生查看班级任务列表。                                       |
| GET    | `/api/classrooms/:id/tasks/:classroomTaskId`                              | 教师/学生查看班级任务详情。                                       |
| PATCH  | `/api/classrooms/:classroomId/tasks/:classroomTaskId`                     | 教师更新课堂任务实例级发布参数（截止时间/迟交/尝试次数）。        |
| PATCH  | `/api/classrooms/:classroomId/tasks/:classroomTaskId/status`              | 教师更新课堂任务实例生命周期状态（关闭/撤回/恢复提交）。          |
| POST   | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`         | 班级发布实例提交入口（绑定 `classroomTaskId`）。                  |
| GET    | `/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`         | 教师分页查看课堂任务实例提交列表（仅 `classroomTaskId`）。        |
| GET    | `/api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`      | 学生端任务聚合详情（Z3）。                                        |
| GET    | `/api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory` | 学习轨迹（Z4）。                                                  |
| GET    | `/api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`         | 课堂复盘包（Z5）。                                                |
| GET    | `/api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`          | AI 运行指标报表（AI）。                                           |

Notes:

- 管理、提交列表、轨迹、复盘和 AI metrics 入口要求 teacher owner；普通任务列表/详情允许 owner teacher 或当前 Enrollment ACTIVE 学生。实例必须属于路径所指班级。
- 发布候选查询仅 owner teacher 可读，非 owner 返回 `404`；仅返回当前教师可见的已发布模板（自己私有、自己共享、他人共享），排除当前班级已发布过的模板。字段见 [DTO 发布候选](./handoff-backend-dto-cheatsheet.md#发布候选模板)；课程分类优先与排序见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)，索引见 [08](./handoff-backend-service-map.md#service-card-08)。
- 新实例默认 ACTIVE；生命周期允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`；撤回要求无提交。拒绝 RECALLED 恢复/再次流转以及 CLOSED -> RECALLED；已有提交而试图撤回返回 `400`，提示只能关闭。
- 实例配置 PATCH 与状态 PATCH 分离：仅 ACTIVE/CLOSED 可编辑发布参数，RECALLED 不可编辑；恢复 ACTIVE 只恢复提交状态，不自动延长截止时间或更改迟交/尝试次数规则。输入/返回字段及旧实例默认状态见 [DTO ClassroomTask](./handoff-backend-dto-cheatsheet.md#classroomtask-dto--response-family)。
- 课堂提交要求班级 ACTIVE、实例 ACTIVE、学生 Enrollment ACTIVE；无需关联模板仍为 PUBLISHED，模板归档不拒绝既有实例提交。有截止时间、禁止迟交且已超过截止时间时，返回 `403`，`code=LATE_SUBMISSION_NOT_ALLOWED`。
- 同一 studentId + classroomTaskId 在冷却窗口内重复提交返回 `429`，`code=SUBMISSION_COOLDOWN_ACTIVE`，并提供重试时间提示；配置与默认窗口见 [Config Matrix](./handoff-backend-config-matrix.md)，提示数据见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
- 实例提交列表非 owner 返回 `404`；严格按 classroomTaskId 读取，默认只包含当前 ACTIVE 学生的 submissions，total 与 items 的成员范围一致。默认提交时间倒序及实现见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)；公开列表、全来源 feedbackCount 与详情内容暴露区别见 DTO Submission。
- my-task-detail 为 student only，仍要求 Enrollment ACTIVE。participationStatus 只提供状态层只读信号，原因优先级为 `CLASSROOM_NOT_ACTIVE > CLASSROOM_TASK_NOT_ACTIVE > ACTIVE`；模板状态只供展示，不决定学生运行态。该信号不包含截止、迟交、冷却或 AI 请求资格，不能替代动作入口的最终校验；字段及反馈预览合同见 [DTO My-task-detail](./handoff-backend-dto-cheatsheet.md#my-task-detail--ai-feedback-summary-family)。
- Learning trajectory 覆盖当前 ACTIVE 学生，包括未提交学生；Review pack 提供该实例的典型问题样例与完整学生分层。两者均支持资源范围内无时间下界的读取，兼容窗口、返回形状和安全暴露分别见 [DTO Trajectory](./handoff-backend-dto-cheatsheet.md#learning-trajectory) / [Review pack](./handoff-backend-dto-cheatsheet.md#review-pack)；内部聚合/样例选择见 [Service Card 08E](./handoff-backend-service-map.md#service-card-08efeature-learning-trajectory-z4) / [08F](./handoff-backend-service-map.md#service-card-08f)。
- AI metrics 的 jobs 与 feedback 均严格按 classroomTaskId 隔离，不跨班；独立窗口集合与 nullable 延迟等公开数据见 [DTO AI Metrics](./handoff-backend-dto-cheatsheet.md#ai-metrics)，内部指标实现见 [Service Card 11](./handoff-backend-service-map.md#service-card-11)。

## Learning Tasks

| Method | Path                                                                 | 用途                                              |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| POST   | `/api/learning-tasks/tasks`                                          | 创建任务。                                        |
| PATCH  | `/api/learning-tasks/tasks/:id`                                      | 更新任务。                                        |
| POST   | `/api/learning-tasks/tasks/:id/publish`                              | 发布任务。                                        |
| POST   | `/api/learning-tasks/tasks/:id/archive`                              | 将作者自己的已发布任务模板归档。                  |
| POST   | `/api/learning-tasks/tasks/:id/restore`                              | 兼容保留入口；稳定返回 400，不再恢复归档模板。    |
| GET    | `/api/learning-tasks/tasks`                                          | 分页查询任务。                                    |
| GET    | `/api/learning-tasks/tasks/:id`                                      | 任务详情。                                        |
| POST   | `/api/learning-tasks/tasks/:id/submissions`                          | 通用任务提交入口（可无 `classroomTaskId`）。      |
| GET    | `/api/learning-tasks/tasks/:id/submissions/mine`                     | 学生查看自己的提交与 `aiFeedbackStatus`。         |
| GET    | `/api/learning-tasks/tasks/:id/submissions`                          | 教师分页查看某任务提交。                          |
| GET    | `/api/learning-tasks/submissions/:id`                                | 提交详情稳定读源（学生本人或有权教师可见）。      |
| POST   | `/api/learning-tasks/submissions/:id/feedback`                       | 教师新增反馈（AI/TEACHER/SYSTEM 结构统一）。      |
| PATCH  | `/api/learning-tasks/submissions/:submissionId/feedback/:feedbackId` | 教师修改自己有权管理的 TEACHER 来源反馈。         |
| GET    | `/api/learning-tasks/submissions/:id/feedback`                       | 提交反馈列表（学生本人或任务教师可见）。          |
| POST   | `/api/learning-tasks/submissions/:submissionId/ai-feedback/request`  | 手工触发 AI 入队请求（幂等）。                    |
| GET    | `/api/learning-tasks/tasks/:id/stats`                                | 任务统计（提交数、去重学生数、top tags）。        |
| GET    | `/api/learning-tasks/tasks/:id/reports/common-issues`                | common-issues 报表（topTags/topTypes/examples）。 |

Notes:

- 模板可见性只影响读取，不改变作者的管理权限。课程分类不参与权限、发布约束或跨课程复用限制；字段/默认/白名单见 [DTO Task template](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family)。
- 模板创建仅允许初始 DRAFT/PUBLISHED，不能直接创建 ARCHIVED；后续单向 `DRAFT -> PUBLISHED -> ARCHIVED`。
- 普通 PATCH 不承担生命周期变更：status 与当前状态不同时返回 `400 Task template status must be changed through lifecycle actions`；相同时忽略该字段并继续编辑其它内容。ARCHIVED 模板普通更新返回 `400 Archived tasks cannot be updated`。
- publish 为 teacher only、作者 only；DRAFT 可发布，PUBLISHED 幂等返回当前模板，ARCHIVED 返回 `400 Archived task templates cannot be published`。
- archive 为 teacher only、作者 only；仅 PUBLISHED 可归档，其余返回 `400 Only published task templates can be archived`。被 ClassroomTask 引用仍可归档，不影响已发布实例运行。
- restore 仅作为 teacher/作者的兼容入口，稳定返回 `400 Archived task templates cannot be restored to draft; clone as draft instead`，不再恢复归档模板。
- 列表 scope 语义：mine 是本人全部模板；shared 是共享池（包含本人共享模板和旧数据缺省 visibility）；all 是本人全部与共享池的可见全集。createdBy 仅保留字段兼容，不能成为越权筛选入口。详情允许作者读取，其他人仅可读共享模板（旧数据缺省也视为共享），他人的 PRIVATE 模板返回 `404`。
- 通用 task submission 可无 classroomTaskId；其模板级统计与 common-issues 入口不能替代课堂实例报表。提交详情 `GET /api/learning-tasks/submissions/:id` 是稳定读源：学生本人可读；有实例关联时仅该班级 owner teacher 可读，无实例关联时仅 task owner teacher 可读；其他用户 `403`，不存在 `404`。字段及 detail/list 的代码暴露区别见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
- 手工 AI request 是登录、RBAC 与资源归属保护的产品能力，不受 AI_FEEDBACK_DEBUG_ENABLED 门禁影响。学生对本人课堂提交请求时要求班级/实例 ACTIVE，不要求模板仍为 PUBLISHED；已有 job 幂等返回（200），无 job 时创建 PENDING job。
- 教师反馈更新要求对 submission 的管理权：有实例关联时是班级 owner，无实例关联时是 task owner；feedback 不存在或不属于该 submission 返回 `404`。仅 TEACHER 来源可改，AI/SYSTEM 返回 `403 Only teacher feedback can be updated`；已有 createdBy 时还必须是该作者，否则 `403 Not allowed to update feedback`。
- 新建 TEACHER feedback 记录当前教师作者；旧 TEACHER feedback 缺失 createdBy 时，有管理权教师可更新并补写作者，保留原 createdAt。字段白名单与兼容投影仅见 [DTO Feedback](./handoff-backend-dto-cheatsheet.md#feedback-dto--response-family)，内部协作见 [Service Card 08](./handoff-backend-service-map.md#service-card-08)。

## AI Feedback Debug / Ops（门禁接口）

门禁条件：

- 全局 SessionAuthGuard 要求登录；路由显式使用 AiFeedbackDebugEnabledGuard + RolesGuard，teacher only。
- `AI_FEEDBACK_DEBUG_ENABLED !== 'true'` 时返回 `404`，优先于角色拒绝的 `403`；它不关闭上文产品手工 AI request。

| Method | Path                                                | 用途                                    |
| ------ | --------------------------------------------------- | --------------------------------------- |
| GET    | `/api/learning-tasks/ai-feedback/jobs`              | 查询 job 队列状态（含失败与重试视角）。 |
| POST   | `/api/learning-tasks/ai-feedback/jobs/process-once` | 手动执行一次处理批次（用于调试/运维）。 |

输入与诊断投影见 [DTO diagnostics](./handoff-backend-dto-cheatsheet.md#ai-feedback-diagnostics--request-family)，Job/批次处理内部职责见 [Service Card 10](./handoff-backend-service-map.md#service-card-10) 及后续处理卡片。

## Maintenance

- 以 endpoint 为单位维护 inventory、角色/归属、生命周期、错误、副作用和高层兼容行为；路径变化在此更新，不要求 DTO 重建一份 endpoint 清单。
- Notes 新增字段矩阵、Query 默认值、nested response 或安全字段列表时，归入 DTO 对应 family，并从本节链接；新增配对、比率分母、查询/排序或聚合步骤时，定位 Service Owner。
- 删除 Notes 前逐条确认公开事实已由正确 Owner 承接；既有跨文档入口锚点保持可达，不用压缩行数代替事实保全。
