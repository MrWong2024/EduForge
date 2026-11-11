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
- 成员与默认教学统计的权威来源为 Enrollment-only（`role=STUDENT,status=ACTIVE`）；旧 `classroom.studentIds` 已退役，不再输出或作为 fallback，公开数据见 [DTO Classroom family](./handoff-backend-dto-cheatsheet.md#classrooms)。
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

Notes:

- teacher only；资源必须由当前教师创建，课程总览仅涵盖该教师名下班级，并遵守全局 Enrollment-only 与课堂任务隔离边界。
- 总览是当前课程口径下的提交覆盖与 AI 运行概览，支持无时间下界的历史读取；各窗口、兼容提交率与整体覆盖率的区别见 [DTO 课程总览](./handoff-backend-dto-cheatsheet.md#课程总览)，聚合见 [Service Card 08C](./handoff-backend-service-map.md#service-card-08c)。
- 课程总览的旧窗口 `1h/24h` 请求返回 `400`；课程总览前端旧链接适配待下一阶段。
- 课程状态为 `ACTIVE | ARCHIVED`；PATCH 支持归档与恢复。已归档课程可通过状态更新恢复，但不允许普通内容编辑。
- 仅无任何班级引用的空课程可删除；非空时返回 `409 Conflict`，`code=COURSE_NOT_EMPTY`，message=`该课程下已有班级记录，不能删除，只能归档`。
- 引用检查与内部一致性见 [Service Card 03](./handoff-backend-service-map.md#service-card-03)。课程分类是对齐坐标，不构成外键或额外权限边界；字段与返回数据见 [DTO Courses](./handoff-backend-dto-cheatsheet.md#courses)。

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
| POST   | `/api/classrooms/:id/students/:uid/remove`            | 教师移除学生。                                                                                                            |

Notes:

- 教师管理与报表入口要求 teacher owner；班级详情允许 owner teacher 或当前正式学生成员。成员权威来源为 Enrollment，不回退 legacy studentIds。
- 正式成员列表仅 owner teacher 可读，非 owner 返回 `404`；默认 ACTIVE，显式包含移除成员时返回 ACTIVE + REMOVED 历史。数据及选项解析见 [DTO Classroom family](./handoff-backend-dto-cheatsheet.md#classrooms)，默认成员排序和读取策略见 [Service Card 04](./handoff-backend-service-map.md#service-card-04)。
- 教师看板默认仅返回 ACTIVE 课堂任务；显式包含关闭任务时返回 ACTIVE + CLOSED；RECALLED、缺失或未知实例状态不返回。既有实例不因关联模板非 PUBLISHED 而消失。统计范围与返回任务集合一致，默认排除 REMOVED 学生历史提交贡献；归档建议只作提示，不自动改变班级状态。
- 学生看板要求当前 Enrollment ACTIVE，默认只展示 ACTIVE 班级内 ACTIVE 课堂任务。模板变为 ARCHIVED/DRAFT 不影响既有实例可见性。有截止时间的任务在截止后 30 天内仍显示为近期过期，更早的归为历史；无截止时间的任务在发布后 90 天内显示，更早的归为历史。includeHistorical 仅放开时间窗口，不放开班级或课堂任务状态边界。
- 看板的状态字段、公开摘要及缺失关联兼容见 [DTO Dashboard / Student state](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family)；归档建议与任务筛选计算分别见 [Service Card 05](./handoff-backend-service-map.md#service-card-05) / [06](./handoff-backend-service-map.md#service-card-06)。
- Weekly report 是 teacher owner 的班级进度/风险/AI 概览，学生范围为当前 Enrollment ACTIVE；窗口与公开数据见 [DTO Weekly report](./handoff-backend-dto-cheatsheet.md#weekly-report)，内部计算见 [Service Card 08B](./handoff-backend-service-map.md#service-card-08b)。
- Weekly report 的旧窗口 `1h/24h` 请求返回 `400`；班级周报前端旧链接适配待下一阶段。
- Process Assessment JSON / CSV 均为 teacher owner 的过程性指标，不能作为正式成绩仲裁；二者使用相同窗口、排除项与查询口径，CSV 媒体类型为 `text/csv; charset=utf-8`。临时任务排除只改变本次分析，不修改教学数据；零提交及排除全部任务时仍返回当前 ACTIVE 学生。
- PA JSON / CSV 两入口对合法教师的 `window=term` 请求均由共用 DTO 的 `IsIn` 校验返回 `400`；既有认证、角色与班级归属规则不变。
- PA 的合法窗口与默认值、零值、rubric 及 CSV 数据合同见 [DTO Process Assessment](./handoff-backend-dto-cheatsheet.md#process-assessment)；评分、risk 与排除重算见 [Service Card 08G](./handoff-backend-service-map.md#service-card-08g)。
- AI Learning Analytics 三个入口统一 teacher only + classroom owner only；课堂不存在或非 owner 返回 `404 Classroom not found`。学生详情仅允许当前课堂 ACTIVE Enrollment 学生，REMOVED、外班及非法学生 id 均安全返回 `404`。
- Analytics 以课堂任务发布时间界定范围，三个入口仅纳入状态为合法标量字符串 ACTIVE/CLOSED 的任务，排除 RECALLED、缺失、null、未知值及数组等非法类型；保留入选任务的完整提交链，并支持当前查询临时排除。学生列表的 q 只匹配姓名/学号，不区分大小写，按字符串子串匹配；q、overallOutcome 与 engagementStatus 采用 AND 组合。非法 Query 按 DTO 校验拒绝（`400`）。方法学 V1.2 取代旧“首个后续版本”比较，区分新增提交与作品更新；公开参数、比较追溯、来源提示及 nullable 指标见 [DTO Analytics](./handoff-backend-dto-cheatsheet.md#ai-learning-analytics)，配对与搜索筛选分页算法见 [Service Card 08I](./handoff-backend-service-map.md#service-card-08i)。
- Analytics 为只读记录对照，不回填、重评、解锁或改写历史业务事实。可用反馈交付排除已知模拟评阅与成功空反馈，历史来源未知不认证为真实模型；不同来源/模型、未比较较新版本及证据不足均提供安全提示。分析仅反映现存作品更新与反馈条目负荷，不覆盖全部 AI 使用，不是缺陷数、正确率、正式成绩、学习能力或因果贡献结论，也不能证明已阅读、理解或采纳。净结果可能相互抵消，不代表时间序列趋势；反馈阶段不表示态度、AI 依赖、能力或风险。
- Snapshot 是 teacher owner 的体积受控教学数据快照导出，超量数据附带截断提示；Query、meta/notes、公开投影与敏感省略见 [DTO Snapshot](./handoff-backend-dto-cheatsheet.md#classroom-export-snapshot)，组合与截断策略见 [Service Card 08H](./handoff-backend-service-map.md#service-card-08h)。
- Snapshot 对合法教师的显式 `window=term` 请求沿既有 DTO 校验返回 `400`；认证、角色与班级 owner 检查顺序不变。
- 班级状态为 `ACTIVE | ARCHIVED`，PATCH 支持归档/恢复。仅无 ClassroomTask 且无 Enrollment 记录（包含 REMOVED 历史）的空班级可删除；只有旧 studentIds 残留不再阻止删除。非空时返回 `409 Conflict`，`code=CLASSROOM_NOT_EMPTY`，message=`该班级已有成员或任务记录，不能删除，只能归档`。

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
- 普通课堂任务列表在分页和计数前仅纳入状态为合法标量字符串 ACTIVE/CLOSED/RECALLED 的实例，items 与 total 共用基础筛选；缺失、null、未知值及数组等非法类型不纳入。Query `status` 仍筛选关联模板的 `Task.status`，不改变为课堂实例状态筛选。
- 普通课堂详情、学生 my-task-detail 及普通列表本次返回页遇到缺失或结构无效的教学快照时返回 `409`，message 为“课堂任务内容快照缺失或无效，请联系教师核对。”；列表不额外扫描全量或过滤异常快照改变分页与 total。实例配置 PATCH、状态 PATCH 和新提交在实际写入前检查快照，沿用原权限、关联及相应状态检查的优先级；GET 不修复快照。
- 发布候选查询仅 owner teacher 可读，非 owner 返回 `404`；仅返回当前教师可见的已发布模板（自己私有、自己共享、他人共享），排除当前班级已发布过的模板。字段见 [DTO 发布候选](./handoff-backend-dto-cheatsheet.md#发布候选模板)；课程分类优先与排序见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)，索引见 [08](./handoff-backend-service-map.md#service-card-08)。
- 发布需校验教师拥有班级且班级可发布，模板为 PUBLISHED 且属于该教师或共享可见；已知 ID 不能绕过可见性，他人不可见模板返回 404。服务端发布时保存教学内容，模板之后编辑/归档不改写实例；发布和更新均不接受 AI 策略字段，普通 PATCH 继续拒绝快照等禁止字段。外链文字被保存，不保证外部文件内容固定。
- 新实例默认 ACTIVE；生命周期允许 `ACTIVE -> CLOSED`、`ACTIVE -> RECALLED`、`CLOSED -> ACTIVE`；撤回要求无提交。拒绝 RECALLED 恢复/再次流转以及 CLOSED -> RECALLED；已有提交而试图撤回返回 `400`，提示只能关闭。
- 普通详情、my-task-detail、发布参数 PATCH、生命周期 PATCH、课堂提交入口及响应映射严格读取实际保存的实例状态：合法三态原样使用；缺失、null、未知字符串、数组或其他类型返回 `409`，message 为 `Classroom task has invalid status`。保持原角色、ownership、Enrollment 与路径归属校验顺序，无权请求不改成状态冲突；异常状态在本次业务写入前拒绝，PATCH 不修复异常状态，读取不回填。
- 实例配置 PATCH 与状态 PATCH 分离：仅 ACTIVE/CLOSED 可编辑发布参数，RECALLED 不可编辑；恢复 ACTIVE 只恢复提交状态，不自动延长截止时间或更改迟交/尝试次数规则。输入/返回字段见 [DTO ClassroomTask](./handoff-backend-dto-cheatsheet.md#classroomtask-dto--response-family)。
- 课堂提交要求班级 ACTIVE、实例 ACTIVE、学生 Enrollment ACTIVE，且实例已保存发布快照；无需关联模板仍为 PUBLISHED，模板归档不拒绝既有实例提交。有截止时间、禁止迟交且已超过截止时间时，返回 `403`，`code=LATE_SUBMISSION_NOT_ALLOWED`。
- 同一 studentId + classroomTaskId 在冷却窗口内重复提交返回 `429`，`code=SUBMISSION_COOLDOWN_ACTIVE`，并提供重试时间提示；配置与默认窗口见 [Config Matrix](./handoff-backend-config-matrix.md)，提示数据见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
- 实例提交列表非 owner 返回 `404`；严格按 classroomTaskId 读取，默认只包含当前 ACTIVE 学生的 submissions，total 与 items 的成员范围一致。默认提交时间倒序及实现见 [Service Card 07](./handoff-backend-service-map.md#service-card-07)；公开列表、全来源 feedbackCount 与详情内容暴露区别见 DTO Submission。
- my-task-detail 为 student only，仍要求 Enrollment ACTIVE。participationStatus 只提供状态层只读信号，原因优先级为 `CLASSROOM_NOT_ACTIVE > CLASSROOM_TASK_NOT_ACTIVE > ACTIVE`；模板状态只供展示，不决定学生运行态。该信号结合快照可用性，不计算截止、迟交或冷却；不能替代动作入口的最终校验；字段及反馈预览合同见 [DTO My-task-detail](./handoff-backend-dto-cheatsheet.md#my-task-detail--ai-feedback-summary-family)。
- Learning trajectory 覆盖当前 ACTIVE 学生，包括未提交学生；Review pack 提供该实例的典型问题样例与完整学生分层。两者均支持资源范围内无时间下界的读取，窗口、返回形状和安全暴露分别见 [DTO Trajectory](./handoff-backend-dto-cheatsheet.md#learning-trajectory) / [Review pack](./handoff-backend-dto-cheatsheet.md#review-pack)；内部聚合/样例选择见 [Service Card 08E](./handoff-backend-service-map.md#service-card-08efeature-learning-trajectory-z4) / [08F](./handoff-backend-service-map.md#service-card-08f)。
- Review pack 的旧窗口 `24h/30d` 请求返回 `400`；课堂复盘前端旧链接适配待下一阶段。
- Learning trajectory 的旧窗口 `24h/30d` 请求返回 `400`。
- Learning trajectory 已移除旧姓名别名 `items[].studentName`，统一使用结构化 student，详细字段与 nullable 合同见 [DTO Trajectory](./handoff-backend-dto-cheatsheet.md#learning-trajectory)。
- AI metrics 的 jobs 与 feedback 均严格按 classroomTaskId 隔离，不跨班；独立窗口集合与 nullable 延迟等公开数据见 [DTO AI Metrics](./handoff-backend-dto-cheatsheet.md#ai-metrics)，内部指标实现见 [Service Card 11](./handoff-backend-service-map.md#service-card-11)。

## Learning Tasks

| Method | Path                                                                 | 用途                                              |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| POST   | `/api/learning-tasks/tasks`                                          | 创建任务。                                        |
| PATCH  | `/api/learning-tasks/tasks/:id`                                      | 更新任务。                                        |
| POST   | `/api/learning-tasks/tasks/:id/publish`                              | 发布任务。                                        |
| POST   | `/api/learning-tasks/tasks/:id/archive`                              | 将作者自己的已发布任务模板归档。                  |
| GET    | `/api/learning-tasks/tasks`                                          | 分页查询任务。                                    |
| GET    | `/api/learning-tasks/tasks/:id`                                      | 任务详情。                                        |
| GET    | `/api/learning-tasks/tasks/:id/submissions/mine`                     | 学生查看自己的提交与 `aiFeedbackStatus`。         |
| GET    | `/api/learning-tasks/tasks/:id/submissions`                          | 教师分页查看某任务提交。                          |
| GET    | `/api/learning-tasks/submissions/:id`                                | 提交详情及安全 AI 评阅摘要（学生本人或有权教师可见）。      |
| PATCH  | `/api/learning-tasks/submissions/:id`                                | 学生本人在进入评阅前修改同一次提交。                    |
| POST   | `/api/learning-tasks/submissions/:id/feedback`                       | 教师新增 TEACHER 来源文字反馈。      |
| PATCH  | `/api/learning-tasks/submissions/:submissionId/feedback/:feedbackId` | 教师修改自己有权管理的 TEACHER 来源反馈。         |
| GET    | `/api/learning-tasks/submissions/:id/feedback`                       | 提交反馈列表（学生本人或任务教师可见）。          |
| POST   | `/api/learning-tasks/submissions/:submissionId/ai-feedback/request`  | 手工触发 AI 入队请求（幂等）。                    |
| GET    | `/api/learning-tasks/tasks/:id/stats`                                | 任务统计（提交数、去重学生数、top tags）。        |
| GET    | `/api/learning-tasks/tasks/:id/reports/common-issues`                | common-issues 报表（topTags/topTypes/examples）。 |

Notes:

- 模板可见性限定模板读取及新课堂发布，不改变作者管理权限，也不为已发布课堂实例、快照、作品、反馈及 AI 请求增加模板可见性门禁。课程分类不参与权限、发布约束或跨课程复用限制；字段/默认/白名单见 [DTO Task template](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family)。
- 模板创建仅允许初始 DRAFT/PUBLISHED，不能直接创建 ARCHIVED；后续单向 `DRAFT -> PUBLISHED -> ARCHIVED`。
- 普通 PATCH 不承担生命周期变更：status 与当前状态不同时返回 `400 Task template status must be changed through lifecycle actions`；相同时忽略该字段并继续编辑其它内容。ARCHIVED 模板普通更新返回 `400 Archived tasks cannot be updated`。
- 创建/保存模板先验证最终生效的 ZIP 引用；创建 PUBLISHED、DRAFT 实际 publish 及课堂发布均须读取验证。DTO 非法和缺失/损坏/不可读/不支持/超限资料返回 400，使用引用/条目序号及安全原因，不暴露系统路径；不保存部分编辑、不创建无效实例。模板已 PUBLISHED 的重复 publish 保持既有幂等语义。配置及公开投影见 [DTO ZIP 资料引用](./handoff-backend-dto-cheatsheet.md#zip-资料引用配置)。
- publish 为 teacher only、作者 only；DRAFT 可发布，PUBLISHED 幂等返回当前模板，ARCHIVED 返回 `400 Archived task templates cannot be published`。
- archive 为 teacher only、作者 only；仅 PUBLISHED 可归档，其余返回 `400 Only published task templates can be archived`。被 ClassroomTask 引用仍可归档，不影响已发布实例运行。
- 模板列表仅纳入实际保存的合法标量 visibility：mine 为本人的 PRIVATE/SHARED 模板，shared 为实际 SHARED（包含本人共享模板），all 为本人合法模板与实际共享模板的并集；合法值及原 scope、status、分类、知识模块和难度条件共同在分页与计数前过滤，items 与 total 使用同一完整条件。发布候选 onlyMine=true 与默认/false 均先排除异常 visibility，再按本人/他人共享、PUBLISHED、已发布排除及原筛选排序规则处理。
- 模板列表不再接受 `createdBy` 查询参数；合法教师会话且其他参数合法时，携带该参数（包括本人或其他教师的合法 ObjectId）由既有全局白名单校验返回 400，message 包含 `property createdBy should not exist`。原认证与角色检查顺序保持。
- 存储 visibility 只接受原值严格等于 PRIVATE/SHARED，不 trim、转换大小写或强制转换；缺失、null、空白、未知值、数组等均非法，响应不补合法默认值。作者详情遇非法值返回 `409 Task has invalid visibility`；非作者仅能读取实际 SHARED，PRIVATE 或非法值均为 `404 Task not found`。update/publish/archive 保持原权限检查优先（非作者 update/publish 为 404，archive 为 403），通过后先拒绝非法存量，再修改或保存；重复 publish 也检查，普通 PATCH 即使提供合法 visibility 也不能顺带修复。
- 新课堂发布先校验教师身份、班级 owner 与班级运行态，再检查模板：不存在为原 404；非作者使用 PRIVATE 或非法值为 `404 Task not found`，作者遇非法值为上述 409。该检查早于快照、资料引用验证和实例创建，合法模板仍遵循原 PUBLISHED、难度、引用及重复发布合同。
- 新作品只经课堂实例入口创建。模板级 submissions/stats/common-issues 继续要求模板作者权限，仅纳入该教师自有班级中属于当前模板的课堂实例；范围过滤先于分页、total、学生去重和反馈聚合。共享模板不授予作者访问他人班级作品的权限。学生 mine 仍仅本人；这些列表及学生看板只接受标量 ObjectId 的 classroomTaskId，不纳入无关联或非法类型提交，不按 taskId 推测归属。
- 提交详情与反馈读取要求有效课堂关联：学生本人可读合法历史作品，不额外要求当前 ACTIVE Enrollment 或 ACTIVE 班级；教师权限仅来自所属班级 owner，不回退模板作者。正常无权用户仍为 `403`；Submission、Task、Feedback 不存在及 Feedback 不属于该提交时保留相应 `404`。字段及 detail/list 的代码暴露区别见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
- 提交详情、反馈 GET/POST/PATCH、提交 PATCH 与 AI request 在基础身份/权限前置检查后统一校验关联：classroomTaskId 缺失、null 或非标量 ObjectId 返回 `409 Submission has no valid classroom task`；实例不存在返回 `404 Classroom task not found`；实例与提交的 taskId 不一致返回 `409 Submission does not match classroom task`；所属班级不存在返回 `404 Classroom not found`。关联失败早于作品修改、评阅版本固定及 Feedback/Job 写入；提交 PATCH 的关联异常不再沿用旧 `403`。
- 所有新提交均不自动创建 AI Job，也不因提交动作固定评阅版本；师生统一从正式 AI request 主动申请。该产品能力受登录、RBAC 与资源归属保护，不受 AI_FEEDBACK_DEBUG_ENABLED 门禁影响。按保存的 classroomTaskId 校验提交/实例/班级关联及快照：学生须本人、Enrollment ACTIVE、班级/实例 ACTIVE；教师须所属班级 owner，可评阅已移出学生的既有作品。旧策略字段缺失或残留均不控制申请资格。合法请求复用既有 Job 的真实状态幂等返回 200，包括 FAILED/DEAD/SUCCEEDED；不重置次数或重新排队，无 retry/reset 入口。合法申请仍先返回 Job，完整输入限额拒绝在异步处理后从详情读取，不改变作品提交成功；无新增预检接口。
- ZIP 读取不进入同步 request：申请仍先检查权限并幂等返回真实 Job 状态。Processor 每次执行重读实例指定资料；不可用或资源超限在 Provider 前直接 DEAD，零模型请求、零伪反馈，分别返回 AI_CONTEXT_UNAVAILABLE / AI_CONTEXT_LIMIT_EXCEEDED 的安全中文摘要，明确作业已保存、未生成反馈并联系教师。完整 messages 超限仍为 INPUT_BUDGET_EXCEEDED。手动申请后的资料/预算失败不回滚作品，无自动换版本、重放或 retry/reset 产品入口。
- 提交详情在原有读取授权之后增加安全 aiReview，师生获得相同的失败、用量和覆盖事实，当前用户动作资格可不同；轻量列表不扩展摘要。字段与 null/0 语义见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)，页面不依赖 debug/ops。
- 有效课堂关联但快照缺失或结构无效时，已保存的作品/反馈仍可按原权限读取；新提交及师生手动 AI request 返回上述快照异常 `409`。AI 检查发生在原权限和关联校验之后、受理评阅及 ensureJob 之前。作品编辑保持现有资格顺序，进入 `SNAPSHOT_MISSING` 分支时返回 `403`，使用同一公开消息；更早的版本、评阅或授权拒绝保持原优先级。教师 Feedback POST/PATCH 沿用原权限、作者、版本及冻结边界，不增加快照要求。提交标题与可用性投影见 DTO Owner。
- 公开教师创建反馈只接受 source=TEACHER；非 TEACHER 值返回 400，不写反馈或 AI Job。内部 Processor 仍保存 AI 来源。
- Submission PATCH 只允许具备学生角色的提交本人；校验有效课堂关联、发布快照、ACTIVE Enrollment 与班级/课堂任务运行态及保存时截止规则，不以是否最新 attempt 代替资格。已进入评阅或已有任何 Feedback/Job 均禁止修改；请求及详情字段见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
- 新增教师反馈与产品 AI request 均要求必填 `expectedRevision`，先完成各入口既有权限、关联及输入校验，再正式受理评阅；AI request 还要求发布快照，教师反馈创建不新增该快照门禁。已有 Job 也不能跳过本次版本和权限校验。竞争失败明确返回 409；查看详情、反馈列表及轮询不固定作品，不回填、清理历史字段或改写时间戳。既有冻结及 Job/反馈/用量事实保留；符合既有执行条件的 Job 继续处理，不补建或重置。版本竞争、固定成功后关联写失败的续行与幂等由 [Service Card 08](./handoff-backend-service-map.md#service-card-08) 维护。
- Submission 版本缺失、null 或非法时，合法课堂关联下已获授权的历史作品与反馈仍可读取；版本及编辑资格投影见 DTO Owner。学生 Submission PATCH、新增教师反馈及师生 AI request 在各自原有版本检查位置返回 `409`，message=“提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。”；保留先行身份、权限、关联、输入及适用快照检查的 `403/404/409` 顺序。教师反馈 PATCH 不依赖 Submission 版本，保留原合同。
- 教师反馈更新要求有效课堂关联及所属班级 owner 管理权；feedback 不存在或不属于该 submission 返回 `404 Feedback not found`。班级权限检查后，仅 TEACHER 来源可改，非 TEACHER 返回 `403 Only teacher feedback can be updated`；随后检查作者，createdBy 缺失、为 null 或其现有 ID 比较结果不等于当前用户，均返回 `403 Not allowed to update feedback`。拒绝发生在反馈字段修改和保存之前，普通更新不补写或认领作者。
- 新建 TEACHER feedback 由服务端记录当前教师作者，重复创建的幂等及 `FEEDBACK_PAYLOAD_CONFLICT` 规则保持；合法更新保留 createdBy 和原 createdAt，updatedAt 沿用 timestamps。AI feedback 可合法没有教师作者；缺作者历史反馈仍按原权限读取，GET 不补写或隐藏反馈。字段白名单与可选投影见 [DTO Feedback](./handoff-backend-dto-cheatsheet.md#feedback-dto--response-family)，内部协作见 [Service Card 08](./handoff-backend-service-map.md#service-card-08)。

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
