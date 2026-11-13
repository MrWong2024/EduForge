# EduForge 前端 API 对接地图

## 0) 本文定位

- 本文描述前端调用层与 BFF proxy / 后端接口 / 页面入口 / 类型适配之间的对接关系。
- 后端 endpoint、权限、生命周期与错误由 [Backend API Map](./handoff-backend-api-map.md) 维护，公开字段与校验由 [Backend DTO](./handoff-backend-dto-cheatsheet.md) 维护；本文只维护前端消费与适配。
- 页面路由、完成度与交互由 [Route Map](./handoff-frontend-route-map.md) 维护；本文中的页面/组件名称仅用于定位调用方。
- 组件职责、UI placement 与导航实现由 [Component Map](./handoff-frontend-component-map.md) 维护，本文不复制这些细节。
- 当前事实以 `frontend/**` 与 `backend/**` 源码为最高优先级；若本文与代码冲突，先核对代码再同步本文。

## 1) 前端 API 调用强制口径

- 正式业务请求必须走同域 `/api/proxy/**`；业务页面和组件不得直接请求后端 origin。
- 后端 origin 由 `FRONTEND_BACKEND_ORIGIN` 控制，BFF route 拼接为 `${FRONTEND_BACKEND_ORIGIN}/api/{path}`。
- Session 依赖后端 `ef_session` Cookie；前端 client 请求统一 `credentials: "include"`。
- Server Component / RSC 请求使用 `frontend/lib/api/client.ts`，它会读取 inbound `cookie` 并转发给 proxy。
- Client Component 请求使用 `frontend/lib/api/browser-client.ts`，浏览器自动携带同域 Cookie。
- `app/api/proxy/[...path]/route.ts` 固定 `runtime = "nodejs"`，仅透传必要请求头：`cookie/content-type/accept/user-agent`。
- proxy 响应透传 `content-type/content-disposition/cache-control/location/set-cookie`；配置缺失或网络错误返回 `502` + `{ method, path, type }`。
- JSON 请求默认 `cache: "no-store"`；下载类链接可直接使用 `buildProxyPath(...)` 生成 `/api/proxy/**` href。
- 错误处理：Server 侧抛 `FetchJsonError`，Client 侧抛 `BrowserFetchJsonError`；原始 data 及 `error-presenter.ts` 提取的 message/code 继续用于内部原因识别，最终说明只显示已生成的业务 summary，不附原始错误；既有公开消息匹配与可操作提示保持。

## 2) API client / helper 文件地图

| 文件 | 主要职责 | 典型调用方 | 注意点 |
|---|---|---|---|
| `frontend/lib/api/client.ts` | Server/RSC fetchJson；拼 `/api/proxy/**`；补 inbound cookie；默认 `no-store` | `app/teacher/**/page.tsx`、`app/student/**/page.tsx`、`lib/auth/session.ts` | Server 侧需要当前 request origin 时可传 `origin` |
| `frontend/lib/api/browser-client.ts` | Client Component fetchJson；拼 `/api/proxy/**`；`credentials: include` | 表单、按钮、生命周期 action 组件 | 不直接拼后端绝对 URL |
| `frontend/app/api/proxy/[...path]/route.ts` | BFF proxy；转发 method/body/header 到后端 `/api/**` | 所有正式业务请求 | 唯一正式后端代理入口；由 `FRONTEND_BACKEND_ORIGIN` 控制上游 |
| `frontend/lib/api/error-presenter.ts` | 保留原始错误提取，最终说明仅返回业务 summary | 表单、页面错误态及内部原因识别 | 不清空或改写原始 data，不改变公开消息匹配与后端语义 |
| `frontend/lib/api/types-teacher.ts` | Teacher 域响应解析、容错 mapper、view-model 辅助类型 | 教师课程/班级/任务/报表页面 | API 字段变化先在这里或对应页面 mapper 收口 |
| `frontend/lib/api/classroom-task-options.ts` | Server-side 分页读取完整课堂任务选项；固定每页 100、按 total/短页停止、最多 20 页并按 `classroomTaskId` 去重 | 过程性评价、AI 反馈介入成效分析 | 只读 `GET classrooms/:classroomId/tasks`；返回排除面板所需 `id/title/publishedAt/dueAt/status`，不承担写操作 |
| `frontend/lib/api/types-student.ts` | Student 域响应解析、容错 mapper、状态解析 | 学生看板、任务详情、提交详情 | 不在 JSX 深层散写 payload 访问 |
| `frontend/lib/auth/session.ts` | `GET users/me` 探针、role gate、登录态读取 | `app/teacher/layout.tsx`、`app/student/layout.tsx` | 当前用户探针驱动认证与角色分流；前端 gate 不替代后端授权 |
| `frontend/lib/http/server-cookie.ts` | Server-only 读取 inbound `cookie` header | `lib/api/client.ts` | 仅用于 Server/RSC 请求透传 session |

当前扫描未发现 `frontend/src/lib/api/**`、`features/**/api*` 或 `hooks/**` 下独立 API helper；新增 helper 时应同步本文。

## 3) 业务域调用地图

### 3.1 Auth / 当前用户

- 登录：`LoginForm` -> `browser-client.fetchJson("auth/login")` -> `/api/proxy/auth/login` -> `POST /api/auth/login`。
  - 调用页面：`/login`。
  - 注意：后端写 `ef_session`；登录成功后再以 `users/me` 确认会话与角色。
- 登出：`LogoutButton` -> `buildProxyPath("auth/logout")` + native fetch -> `/api/proxy/auth/logout` -> `POST /api/auth/logout`。
- 忘记密码：`ForgotPasswordForm` -> `/api/proxy/auth/forgot-password` -> `POST /api/auth/forgot-password`。
  - 调用页面：`/forgot-password`。
  - 注意：消费后端防枚举响应；客户端 UX 节流不是权威门禁，服务端 cooldown 始终为最终约束。
- 重置密码：`ResetPasswordForm` -> `/api/proxy/auth/reset-password` -> `POST /api/auth/reset-password`。
  - 调用页面：`/reset-password`。
  - 注意：token 只从 URL query 读取，不写入 storage/cookie。
- 当前用户：`lib/auth/session.ts` -> `client.fetchJson("users/me")` -> `/api/proxy/users/me` -> `GET /api/users/me`。
  - 调用方：`app/teacher/layout.tsx`、`app/student/layout.tsx`、教师提交详情页。
  - 注意：Teacher / Student role gate 的登录态锚点。
  - 角色消费：资格、首页选择与账户标签只读取 `roles` 数组，公开数据见 [Backend DTO Auth](./handoff-backend-dto-cheatsheet.md#auth-public-responses) / [Users](./handoff-backend-dto-cheatsheet.md#users)。内部 `TEACHER/STUDENT` 分别对应 API 原值精确为 `teacher/student` 的元素；旧单值 `role` 不再参与，不通过 `String`、trim 或大小写转换修正角色元素。
  - 首页与标签：双教学角色仍教师优先；admin-only、user-only 或无教学角色仍无教学端首页资格，沿用既有展示降级。正式小写角色按原值映射账户标签，未知非空字符串只按原文展示，不授予资格；纯空白和非字符串不生成标签。前端入口判断不替代后端授权。
- 当前用户改密：`ChangePasswordForm` -> `/api/proxy/users/me/change-password` -> `POST /api/users/me/change-password`。
  - 注意：会话失效策略由后端处理，前端不自行清理其它 session。

### 3.2 Teacher 课程 / 班级 / 成员

- 课程列表与详情：Server pages -> `client.fetchJson("courses...")` -> `/api/proxy/courses*` -> `GET /api/courses*`。
  - 调用页面：`/teacher/courses`、`/teacher/courses/:courseId/overview`、`/teacher/courses/:courseId/edit`。
  - 注意：课程总览请求参数见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#课程总览)，页面交互由 Route Map 维护。
- 课程创建/编辑：`CreateCourseForm`、`EditCourseForm` -> `/api/proxy/courses*` -> `POST/PATCH /api/courses*`。
  - 调用页面：`/teacher/courses*`。
  - 注意：`courseLabel` 值域来源仍由前端统一候选和后端 DTO 校验共同约束。
- 课程生命周期：`CourseLifecycleActions` -> `/api/proxy/courses/:id` -> `PATCH/DELETE /api/courses/:id`。
  - 调用页面：`/teacher/courses`。
  - 注意：`COURSE_NOT_EMPTY` 只做展示，不在前端重判删除条件。
- 班级列表与详情：Server pages -> `/api/proxy/classrooms*` -> `GET /api/classrooms*`。
  - 调用页面：`/teacher/classrooms*`。
- 教师班级看板：`teacher/classrooms/[classroomId]/dashboard/page.tsx` -> `/api/proxy/classrooms/:id/dashboard` -> `GET /api/classrooms/:id/dashboard`。
  - 列表、摘要及任务展示通过 `getDashboardItems` 与 `lib/teacher-dashboard.ts` 仅消费正式读源，备用包装与字段别名不再补值；公开字段合同见 [Backend DTO：Teacher / Student Dashboard response family](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family)。
- 班级创建/编辑：`CreateClassroomForm`、`EditClassroomForm` -> `/api/proxy/classrooms*` -> `POST/PATCH /api/classrooms*`。
  - 调用页面：`/teacher/classrooms*`。
- 班级生命周期：`ClassroomLifecycleActions` -> `/api/proxy/classrooms/:id` -> `PATCH/DELETE /api/classrooms/:id`。
  - 调用页面：`/teacher/classrooms`。
  - 注意：`CLASSROOM_NOT_EMPTY` 只做展示；Enrollment 历史由后端判定。
- 课程/班级基础响应适配：实体标识只取正式 `id`，包括班级内嵌课程；旧 `courseId/classroomId` 不再作为实体 ID 别名补足。创建、详情与更新只消费顶层实体，课程总览只消费顶层 `course/items` 及元信息，不再选择 `data`。两种列表只读顶层 `items` 和同名分页字段；裸数组、`data.items`、`data` 数组及旧分页来源不再参与，缺失或非法分页保持 `undefined`，不从数组长度派生。完整字段与统计合同见 [Backend DTO Courses](./handoff-backend-dto-cheatsheet.md#courses)、[Classrooms](./handoff-backend-dto-cheatsheet.md#classrooms) 及[课程总览](./handoff-backend-dto-cheatsheet.md#课程总览)。
- 教师课程与班级主列表在 mapper 之后通过 `isValidPaginationTotal` 执行页面门禁：只接受正式根字段中的非负安全整数 number `total`，0 合法；缺失或非法时进入读取错误，不用当前页长度或默认值补足总数。班级页辅助课程请求只消费 `items` 供选项和名称映射，不适用此门禁。
- 关系与可选摘要：真实关系字段 `Classroom.courseId` 和总览行 `items[].classroomId` 保留；班级内嵌 `course` 可缺省，不影响班级及所属课程 ID。课程摘要有可读资料但缺少 `id` 时仍按原规则保留，不强制完整对象，也不从旧实体别名恢复标识。
- 课程/班级主响应状态适配：`normalizeCourseStatus`、`normalizeClassroomStatus` 仅接受原值精确等于 `ACTIVE` 或 `ARCHIVED`；不经 `asString` 预处理，不 trim、转换大小写或强制转换类型，其余输入（含缺失）均为 `undefined`，不补合法默认值、不修改输入。班级内附带的 `ClassroomCourseSummary.status` 仍为普通字符串投影，不在该收口范围。后端状态及接口规则见 [API Courses](./handoff-backend-api-map.md#courses) / [Classrooms](./handoff-backend-api-map.md#classrooms)。
- 班级成员：`members/page.tsx`、`RemoveStudentButton` -> `/api/proxy/classrooms/:id/students*`。
  - 对应后端：`GET /api/classrooms/:id/students`、`POST /api/classrooms/:id/students/:uid/remove`。
  - 注意：成员列表使用正式后端读源，禁止回退到 `studentIds`。
  - 响应适配：只消费正式顶层 `items/total/page/limit`，公开字段合同见 [Backend DTO：Classrooms](./handoff-backend-dto-cheatsheet.md#classrooms)。裸数组、`data.items`、`data` 数组及 `data` 内或 `pagination.*` 的分页不再参与适配；顶层空 `items` 不被旧包装替换，正式分页缺失或非法时保持 `undefined`，只有旧包装时降级为空列表且分页均为 `undefined`。
  - 字段适配：`id → userId`、`joinedAt → enrolledAt` 是前端命名转换；`name/email/studentNo` 只读成员顶层同名字段，旧 ID、资料、时间别名及嵌套来源不再补足缺失或非法的正式字段。不因成员缺字段过滤整行，不改写输入；根 `raw` 保持原 payload 引用，对象成员的 `raw` 保持原对象引用，旧键可保留于 `raw` 但不参与投影。
  - 状态适配：`ClassroomStudent.status` 为可选的 `"ACTIVE" | "REMOVED"`，仅保留 `record.status` 原值精确匹配的两态；不 trim、转换大小写或强制转换类型。缺失及其他非法值均为 `undefined`，不读取旧别名 `enrollmentStatus`，不再默认 `ACTIVE`，未知状态不推定为在班成员。

### 3.3 Teacher 任务 / 提交 / 反馈

- 任务模板列表：`/teacher/tasks/page.tsx` -> `/api/proxy/learning-tasks/tasks?...` -> `GET /api/learning-tasks/tasks`。
  - 注意：`scope/courseLabel/status/knowledgeModule/difficulty/page` 由 URL 驱动并透传后端。模板列表与课堂候选页忽略旧 URL 的 `stage`，筛选、分页和回跳链接不再携带它；后端参数合同见 [DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md#learning-tasks)。
  - 模板 SSR 在 mapper 之后使用现有 `isValidPaginationTotal` 作为本链唯一运行时 total 门禁，0 合法，缺失或非法时进入读取错误；页面总数、分页及 `LearningTaskFilters` 的必填 `total` 统一消费验证后的值，不用页长补数。组件不重复校验或缓存 total；门禁不下沉至共享 mapper，也不扩展到课堂发布候选链。
  - 模板及发布候选的实体标识仅取正式 `id`，内部 `createdById` 仅由正式字符串 `createdBy` 命名转换；不从响应旧 `taskId`、作者对象、顶层 `createdById`、publisher 或 raw 补身份。详情、创建与更新只适配正式根对象，两类列表只读根 `items/total/page/limit`；旧裸数组和 `data` 包装不补列表、分页或身份，缺 ID 的对象行仍保留。公开字段见 [Backend DTO Task template](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family)；编辑路由及课堂发布请求中的正式 `taskId` 保持。
  - 可选 rubric、资料引用及其他正式信息继续沿现有解析；引用缺省为 `undefined`、显式 `[]` 保留、非法正式引用仍拒绝，旧 `data` 不参与救援或覆盖。列表 raw 保持原 payload，对象成员 raw 保持原成员，单实体 raw 保持原根对象；不修改输入或清洗 raw 中的旧键。
  - 难度筛选与下述模板写入选项分开：字段名“任务难度”，选项为全部难度（UI `""`，请求省略）、基础 `easy`、进阶 `medium`、挑战 `hard`，复用共享三档目录；不提供未设置/其他筛选。`parseDifficultyFilter` 只接受准确单个标准值，非法 URL 值（含数组）按全部显示且不传后端，后续筛选及分页导航移除非法值；不据此清洗存储或展示值。模板 SSR、筛选控件及外层实际分页链接使用规范化难度，筛选变更回第1页，保留其他条件和 fromClassroomId，编辑 returnTo 保留当前列表条件；清空筛选包含难度并沿用既有 scope 重置规则。
- 任务模板创建：`CreateLearningTaskForm` -> `/api/proxy/learning-tasks/tasks` -> `POST /api/learning-tasks/tasks`。
  - 注意：初始 `status` 遵循后端创建 DTO；创建与后续生命周期请求不混用。
- 任务模板编辑/生命周期：`EditLearningTaskForm` -> `/api/proxy/learning-tasks/tasks/:id*`。
  - 对应后端：`GET/PATCH /api/learning-tasks/tasks/:id`、`POST /publish`、`POST /archive`。
  - 注意：内容更新与生命周期采用各自后端接口，普通保存不构造状态流转；权限与生命周期由后端最终校验。
  - 模板 visibility 响应统一委托 `normalizeTaskTemplateVisibility`，仅原值严格等于 PRIVATE/SHARED 合法，其余为 undefined；不 trim、转换大小写或强制转换，不补共享或其他合法默认值。输入不改写，raw 保持原有来源引用；URL scope 规范化、新建默认 PRIVATE 与后端请求规范化保持。标签仅精确两值显示私有/共享，缺失、null、空串及纯空白显示“—”，其他非法原值显示“未知可见性”；mapper 已归为 undefined 时沿用占位。后端可见范围、存储校验和权限错误顺序见 [Backend API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
  - 编辑详情 409 提示“任务模板可见性异常，请刷新页面核对。”；保存、发布、归档 409 提示“任务模板可见性异常，暂时无法操作，请刷新页面核对。”，保留状态码、内部原始错误及既有错误呈现。当前权威 visibility 或草稿不可用时只读并提示刷新核对，不以旧合法草稿掩盖异常初值。
  - 保存响应除现有 id 与资料引用确认，还须返回合法 visibility 且与本次实际发送值一致；全部确认先于任何保存基准更新、成功提示及刷新。缺失、非法或不一致时提示“保存结果无法确认，请刷新页面核对后再操作。”，保留草稿，不自动刷新或重放 PATCH；该结果不能证明服务端未写入。正常成功与生命周期成功处理沿原流程。
  - 教师模板类型及 create/detail/update/list 适配保留 `aiContextRefs`；字段缺省表示无引用，非法引用响应使加载/保存确认失败，不回退为空配置。页面创建沿上述 BFF 保存并省略引用，正式 API 及共享请求类型仍支持该字段；编辑仅在引用语义改变时发送完整数组，未变更省略，显式 `[]` 清空；成功响应更新比较基准。完整字段、验证与快照合同见 [Backend DTO ZIP 资料引用配置](./handoff-backend-dto-cheatsheet.md#zip-资料引用配置)。课堂公开接口及学生消费不补取教师模板资料。
  - `difficulty` 的写入 UI 仅有四状态，由 `lib/learning-tasks/difficulty.ts` 维护：未设置 `""`、基础 `easy`、进阶 `medium`、挑战 `hard`；后端写入约束见 [Task template DTO](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family)。创建未选时省略字段，选定时发送英文值；编辑未变省略，明确清空发送 `difficulty:""`，不发送 null 或自定义值。编辑下拉框不提供动态旧值选项，意外未知初值映射为未设置，未改难度时仍省略，不随标题修改隐式清理数据库。成功创建重置难度，编辑成功按正式响应同步，失败保留草稿。
  - 模板顶层 `difficulty` 原值进入模板 view model，mapper 不转换或改写上游数据，raw 引用保持；表单只读、模板列表、发布选择及师生课堂详情复用同一安全显示函数：只有准确三档显示基础/进阶/挑战，缺失、null、空白、未知字符串或非法类型统一显示未设置。不做别名、大小写或自动判级，也不将安全显示回写数据库。难度只用于教学定位，不影响评阅标准或统计校正。
- 班级发布候选：`PublishClassroomTaskForm` -> `/api/proxy/classrooms/:id/publishable-task-templates`。
  - 对应后端：`GET /api/classrooms/:id/publishable-task-templates`。
  - 注意：模板可见性、发布资格及本班已发布排除由后端候选接口决定，前端不自行伪造候选全集。当前候选 DTO 不提供 rubric、aiContextRefs，继续允许缺省；缺少 rubric 只能提示到模板详情核对，不能判断模板未填写评阅标准。后端候选的 `createdById` 仍是合法字段，但前端不新增读取回退，作者来源仍为字符串 `createdBy`；完整字段见 [Backend DTO 发布候选模板](./handoff-backend-dto-cheatsheet.md#发布候选模板)。
  - 候选难度沿用上述筛选选项与解析口径，首次 SSR 查询和加载更多都传同一规范化条件；URL/权威 props 恢复控件与已应用条件。共用入口的筛选实际变化或清空即清除已选 taskId、使旧加载更多请求失效，保留截止/迟交草稿；更新期间禁止选择、加载更多及发布，submit handler 同时校验等待状态和当前候选成员。权威新结果替换候选池并同步页码/总数/limit，旧请求的成功、错误及 finally 均不得覆盖新状态，不自动选首条或重放发布；失败沿用原错误呈现并允许显式重试。
- 班级任务实例：`/teacher/classrooms/:id/tasks/page.tsx` + 发布/生命周期/编辑组件 -> `/api/proxy/classrooms/:id/tasks*`。
  - 对应后端：`GET/POST/PATCH /api/classrooms/:id/tasks*` 与 `/status`。
  - 响应身份只取正式根 `id`：summary 将其命名为内部 `classroomTaskId`，详情保留 `id`；真实根关系字段 `classroomId/taskId`、URL 中的实例 ID 和发布请求 `taskId` 保持，不由嵌套模板 ID 补足。教学内容只取 `task`，迟交设置只取 `settings.allowLate`，发布时间只取根 `publishedAt`，旧根内容、设置及嵌套发布时间不再补足；公开字段见 [Backend DTO ClassroomTask](./handoff-backend-dto-cheatsheet.md#classroomtask-dto--response-family)。
  - 实体直接适配根对象，列表只消费根 `items/page/limit/total`，不再选择 `data` 或裸数组、不从数组长度派生分页；空或缺失正式来源沿原降级，缺 ID 的对象行仍保留。详情及发布响应 raw 保持原根引用，summary/list 不新增 raw；移除无实际消费者的 summary `aiStatus` 和详情 `feedbackEnabled` 专用投影，不改输入或清洗历史键。
  - 已发布课堂任务主列表 SSR 在 mapper 后复用 `isValidPaginationTotal`，以验证后的 total 计算统计与分页，0 合法，不再用当前页长度补总数；缺失或非法时显示“课堂任务列表数据不完整，请刷新后重试。”，本地读取错误不填写虚构 HTTP 状态。此门禁仅覆盖主列表，不纳入发布候选池。
  - `toClassroomTaskSummary`、`toClassroomTask` 共用 `normalizeClassroomTaskStatus`，仅接受原始值严格等于 `ACTIVE`、`CLOSED`、`RECALLED`；不 trim、转换大小写或强制转换类型，其余输入为 undefined，不再补 ACTIVE，也不映射为其他合法状态。保留可选状态类型、输入对象不变及详情 raw 原引用；未知状态不移除只读导航、教学内容或已有记录。
  - 实例设置 PATCH 保持原路径与 `dueAt/allowLate` 请求体；精确快照异常优先显示共享安全提示，其余 409 继续显示“课堂任务状态异常，暂时无法修改，请刷新页面核对。”，保留原状态码、内部原始错误与 ErrorState 呈现。保存失败保留草稿，不自动重放 PATCH；服务端错误、权限和生命周期合同见 [Backend API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。
  - 快照三态由 `getTaskSnapshotMessage` 统一显示：true 为“已保存的课堂任务内容”，false 为“课堂任务内容快照缺失或无效，请联系教师核对。”，undefined 为“课堂任务内容信息暂不可用，请刷新核对后继续。”。保留严格布尔适配和提交资格判断，不查询当前模板补课堂内容。
  - `getTaskSnapshotErrorMessage` 只识别 403/409 下非 null、非数组对象的 message 原值精确等于上述快照异常消息，并返回固定安全提示；不 trim、匹配子串或依据 code 推测。教师任务列表/详情、学生任务详情、设置与生命周期，以及发布表单的发布请求按各自入口状态局部接入，匹配失败沿用原错误分支；发布候选加载、筛选和分页保持原处理。原始 status/data 与 detail 提取继续保留，最终说明仅展示安全 summary。后端入口状态码和写前拒绝由 [Backend API Owner](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源) 维护。
  - 注意：发布表单只发送既有截止/迟交设置，不发送 AI 策略字段。列表/详情消费快照可用性及投影教学内容，不另取当前模板覆盖，不适配或展示旧策略。实例配置与状态动作分开发送；学生或教师可在提交详情主动申请 AI 反馈。
  - 发布请求仍仅使用 `taskId/dueAt/settings`，不传 difficulty；教师课堂详情的难度由 `toClassroomTask` 读取正式 `task.difficulty` 原值，后端负责发布快照。模板修改不覆盖已发布快照，前端不另查实时模板或回填缺失难度。
  - 班级页面的 difficulty 只作用于待发布候选，已发布课堂任务请求不带该参数；已发布任务的分页链接保留规范化候选难度，避免翻页丢失候选条件。
- 课堂任务工作区名称：现有 Server `tasks/:classroomTaskId/layout.tsx` 经当前 request origin、Cookie/BFF 与 `no-store` 并行读取 `GET classrooms/:classroomId` 和 `GET classrooms/:classroomId/tasks/:classroomTaskId`，分别由 `toClassroomDetailResponse`、`toClassroomTask` 提取展示名称；任务标题沿用课堂实例正式投影，不另查当前模板。两项辅助读取各自有限超时、独立降级为明确占位，不替换 children 或子页主体错误处理。
- 课堂任务提交列表：`submissions/page.tsx` -> `/api/proxy/classrooms/:cid/tasks/:ctid/submissions`。
  - 对应后端：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`。
  - 仅消费正式根列表、分页与行字段，备用包装及字段别名不再补值；行 `id`、`student.id`、`student.name` 分别是内部 `submissionId`、`studentId`、`studentName` 的正式来源。公开字段合同见 [Backend DTO：Submission request / response family](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。
  - 注意：只按 `classroomTaskId` 读取，不用 `taskId` 兜底过滤。
- 提交详情和反馈：Teacher/Student submission pages + feedback forms -> `/api/proxy/learning-tasks/submissions/:id*`。
  - 对应后端：submission detail、feedback list、teacher feedback create/update。
  - 反馈列表只消费正式裸数组，`items`、`data.items`、`data` 数组包装不再供数；字段合同见 [Backend DTO：Feedback DTO / response family](./handoff-backend-dto-cheatsheet.md#feedback-dto--response-family)。
  - 共享提交详情 mapper 只消费根对象与正式 `submittedAt`，已退役 `data` / `submission` 包装选择及前端 `createdAt` 补值；`language` 仍依次读取根字段与 `content.language`，服务现行创建/详情合同，字段定义见下述 Backend DTO。
  - 注意：正式 detail API `GET /api/learning-tasks/submissions/:id` 是主体 SoT；每次先 await detail 成功，再请求同一提交的 feedback；师生共用学生侧详情 mapper，保留完整源码、独立说明与已有声明原文，适配 aiReview；URL query 不提供标题、正文、提交时间、次数、迟交或 AI 状态；班级/课堂任务上下文用于返回导航。公开字段与 null/0 语义由 [Backend DTO](./handoff-backend-dto-cheatsheet.md#submission-request--response-family) 维护。
  - 教师提交详情 Server Page 在主体加载成功后独立调用既有 `getMe()`，仅把正式响应中非空、非纯空白的字符串 id 原值作为 currentUserId 传入 History / EditForm，不传整个用户或其他身份数据。身份读取失败或 id 不可用时，历史反馈只读并提示刷新；不替换已加载的作品/反馈，不改变 layout 角色检查、新增反馈或 AI 请求。
  - 历史反馈修改资格由 `canEditTeacherFeedback` 统一判断：来源精确为 TEACHER，反馈 id、currentUserId 和 createdBy 均为非空非纯空白字符串，且作者与当前用户原字符串精确相等；不 trim 后比较、转换大小写、补作者或增加 ObjectId 格式规则。未知/他人作者、AI 和未知来源只关闭修改入口，原记录仍可读；共享 mapper 与 createdBy 可选投影保持，最终班级管理权及作者授权见 [Backend API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)。
  - 历史修改继续 PATCH `learning-tasks/submissions/:submissionId/feedback/:feedbackId`，只发送原差异业务字段，不发送身份、作者、来源、归属或时间戳。403 等失败保留状态码、内部原始错误和草稿，不调用 onSaved、刷新或自动重放；成功沿用 onSaved 与 router.refresh，不新增响应确认或认领协议。
  - 新增教师反馈发送撰写时绑定的 `expectedRevision`；刷新 props 不重绑旧评语。409/结果不确定保留评语，显式读取权威作品及反馈列表，用户确认适用后再允许继续。教师反馈原地 PATCH 沿用原合同；固定、版本与幂等合同见 [Backend Service Card 08](./handoff-backend-service-map.md#service-card-08)。

- 教师提交页的可选评阅标准：在权威 detail/feedback 成功后，使用上下文 classroomId 与 detail 的权威 classroomTaskId 经 BFF 读取 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId`，复用 `toClassroomTask`；仅当响应 taskId 与提交 detail 一致时展示实例投影 rubric。上下文只定位请求，评阅标准来自正式响应；无上下文、读失败或不匹配时提示从任务详情核对，不替换已保存作品或反馈表单。

### 3.4 Student 学习链路

- 学生看板：`student/dashboard/page.tsx` -> `/api/proxy/classrooms/mine/dashboard` -> `GET /api/classrooms/mine/dashboard`。
  - 仅消费正式响应，已退役备用响应包装与字段别名回退；公开字段合同见 [Backend DTO：Teacher / Student Dashboard response family](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family)。
  - 注意：完成状态消费后端 `completionStatus`，不从 AI 状态或历史提交二次推断。
- 加入班级：`JoinClassroomForm` -> `/api/proxy/classrooms/join` -> `POST /api/classrooms/join`。
  - 注意：只提交 joinCode，入班权限与重复入班由后端判定。
- 学生任务详情：`student/classrooms/:cid/tasks/:ctid/page.tsx` -> `/api/proxy/classrooms/:cid/tasks/:ctid/my-task-detail`。
  - 对应后端：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`。
  - 注意：消费 `participationStatus`；模板当前状态不作为前端阻断依据。前端历史展示按 `createdAt` 倒序，排序不改变后端 latest、完成状态及参与资格。
  - 参与原因白名单与 [Backend DTO：Student completion / participation public state](./handoff-backend-dto-cheatsheet.md#student-completion--participation-public-state) 的当前集合一致，合法原因及后端计算规则由该 Owner 维护；不再接受 `TASK_NOT_PUBLISHED`，旧或未知原因按参与资格不可用处理，不推定允许提交。
  - 基础信息难度直接读取正式响应的 `viewModel.data.task.difficulty`，复用上述共享显示规则；沿用后端 task 投影，不查询实时模板补值。
- 学生提交：`SubmissionForm` -> `/api/proxy/classrooms/:cid/tasks/:ctid/submissions`。
  - 对应后端：`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`。
  - 注意：提交入口要求明确快照可用且后端 canSubmit=true，不以模板状态或 AI 发起权限代替提交资格。content 中的源码和可选说明原样发送；说明按 Unicode 码点校验。取得有效提交 ID 后锁住当前表单并走既有路径进入本次详情，导航恢复只打开该已保存提交，query 只用于返回导航；提交成功不表示 AI 已申请。成功缺 ID 或网络结果未确认时先核对历史，不自动重放。getTextSubmissionError 在 409 分支使用共享快照错误 helper，旧快照消息不再是正向白名单；归档、关闭、迟交、冷却及未知错误沿用原处理。迟交、冷却和授权仍由后端最终校验。
- 学生 submission detail：`student/submissions/:id/page.tsx` -> `/api/proxy/learning-tasks/submissions/:id*`。
  - 对应后端：submission detail、feedback list。
  - 注意：学生任务草稿页仅显式刷新；学生提交详情仅在处理中或已安排重试时状态驱动刷新，复用现有读源，无历史详情 N+1。
  - `EditSubmissionForm` 经同源 BFF PATCH 同一 submission，使用编辑开始时的 `expectedRevision` 和允许 content 字段，正常保存显式发送说明；取消不写，成功采用权威详情。mapper 严格消费 revision/editing，缺失或未知关闭入口；冲突/未知结果保留草稿，读取作品并由用户明确核对，不自动换新 attempt、合并或重放。
  - 作品编辑仅对精确快照 403 使用共享提示并追加“未保存的修改已保留。”；其他权限及版本错误维持原分支，blocked/busy、草稿与结果不确定恢复机制保持。

### 3.5 AI Feedback / 报表 / 导出

课程总览、课堂复盘、班级周报的共性窗口规则：先由 `getSingleSearchParam` 对重复 window 取首值，再由 `parseEnum` 按各页允许集合精确匹配原值，默认 `all`。省略、空值、不在允许集合内的旧窗口、`term`、大小写或空白变体及其他非法值统一回落 `all`，不 trim 或转换大小写；请求始终显式发送同一规范化 window。

- AI Feedback 产品请求：`SubmissionAiReview`（组合 RequestAiFeedbackButton） -> `/api/proxy/learning-tasks/submissions/:id/ai-feedback/request`。
  - 对应后端：`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`。
  - 师生手动申请的精确快照 409 优先于版本错误 helper，匹配失败继续现有版本/通用提示；不把快照错误加入 getSubmissionRevisionError，也不增加教师反馈表单的快照门禁。
  - 注意：请求携带页面实际展示作品的 `expectedRevision`，轮询发现新版不能视为用户已查看；需要明确刷新作品后申请。仅有效 revision 且 aiReview.canRequest=true 开启动作，缺摘要关闭并提供刷新。成功采用接口真实返回状态，已有 Job 不重新排队；当前提交内串行申请与读取，操作标识拒绝旧结果，页面 props 不作为 POST 后确认。成功 Job 持续锁定申请；结果不确定后，只接受事后用户显式发起、完整成功的详情读取重新判断资格，不自动重放 POST。按钮、正文与轮询共用同一已接纳结果。学生详情可按状态刷新，教师详情仅局部显示申请结果并提示显式刷新，保护人工反馈草稿。request 不返回完整 aiReview；执行仍归后端。BFF 保持既有 PATCH/JSON body 透传。
  - 师生共用 `lib/learning-tasks/ai-review.ts` 的 `toAiReview` 适配及 `SubmissionAiReview` 展示后端用量摘要；页面不重新统计或派生 Token。新增细分及计算字段缺省、null 或非法时统一映射 null，合法 0 保留显示“0”，未知显示“未知”。公开字段、计算值含义和包含关系由 [Submission DTO](./handoff-backend-dto-cheatsheet.md#submission-request--response-family) 维护。
  - 受控详情确认：原始 `detail.raw.aiReview.usage` 必须包含 [Submission DTO](./handoff-backend-dto-cheatsheet.md#submission-request--response-family) 规定的全部自有字段；缺键响应不作为完整确认，字段明确为 null 仍表示合法未知信息，不补造用量。
- 班级周报：`weekly-report/page.tsx` -> `/api/proxy/classrooms/:id/weekly-report`。
  - 对应后端：`GET /api/classrooms/:classroomId/weekly-report`。
  - 四项比率均按固定 ratio 转为百分比展示，保留现有精度、数字字符串解析及空值处理。
  - 页面窗口为 `7d | 30d | all`；解析与请求沿用本节三页报表共性窗口规则。
  - 注意：窗口与公开数据见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#weekly-report)。前端只消费顶层 `classroom/progress/atRisk/aiHealth/topTags` 及 `window/generatedAt`；旧 `summary/overview/data`、扁平指标和替代 jobs 路径不再参与选值，也不再投影无用的顶层 `classroomId/items`。页头通过 `toClassroomSummary` 读取正式 `classroom` 投影，不新增请求；正式来源缺失沿用占位与空态，真实 0 和现有格式保持，raw 仍引用原根对象。
- 课程总览：`courses/:courseId/overview/page.tsx` -> `/api/proxy/courses/:courseId/overview`。
  - 对应后端：`GET /api/courses/:courseId/overview`。
  - 比例固定按 ratio 展示，当前页两项比例均值按班级等权计算并保持 ratio，仅在最终展示时转换一次为百分比；不按数值大小猜测单位，也不将分页摘要视为全课程平均。
  - 页面窗口为 `all | 7d`；解析与请求沿用本节三页报表共性窗口规则，后端数据合同见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#课程总览)。
- 学习轨迹 / 课堂复盘 / AI 指标：三件套 Server pages -> `/api/proxy/classrooms/:cid/tasks/:ctid/{learning-trajectory,review-pack,ai-metrics}`。
  - 对应后端：三个课堂任务聚合接口。
  - AI 指标保留内部展示名称：`statusBreakdown` 只取正式 `summary.jobs`，`tags` 只取正式 `feedback.topTags`；不再读取顶层同名旧字段或 `summary.statusBreakdown`，正式来源缺失、非法或为空时沿现有对象/数组降级，不补足。窗口、includeTags 及公开数据见 [Backend DTO AI Metrics](./handoff-backend-dto-cheatsheet.md#ai-metrics)；真实 0、null 耗时、含 total 的状态展示与对象/raw 引用保持。
  - 课堂复盘窗口为 `all | 7d`；解析与请求沿用本节三页报表共性窗口规则，后端数据合同见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#review-pack)。
  - 课堂复盘的提交率与 AI 成功率固定按 ratio 展示；“成功约 N”仍使用未格式化百分数还原后的比率估算。
  - 课堂复盘只从正式 `overview/commonIssues` 读取概览、摘要与问题分布，不再用旧指标别名或按人数补算缺失率；分布只取正式 `tag/type/severity/count`。分层学生的 ID/姓名仅消费 `studentId/studentName`，不以旧别名补足，也不再投影或展示后端未返回的 ReviewPack 专用 `latestAiFeedbackStatus`；未知姓名、学号 null、真实 0、原格式和 raw 引用保持。样例的正式 `tags/matchedTags`、合并去重和提交链接继续保留。
  - 学习轨迹的根 `studentId` 与结构化 `student.id` 独立解析，不互补或合成学生对象；名称仅从结构化 `student` 依次选择姓名、学号、邮箱、`未知学生`，不读取旧姓名别名或从 raw 补学号/邮箱。尝试显示时间只取 `createdAt`，不回退 `submittedAt`。后端字段结构及 nullable 合同见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#learning-trajectory)。
  - 学习轨迹 window 仅接受精确的 `all | 7d`，默认 `all`；省略、空值、`24h`、`30d`、`term`、大小写或空白变体及其他未知值统一沿用 `parseEnum` 回落为 `all`，不 trim 或转换大小写。重复 window 沿用 `getSingleSearchParam` 取首值，请求使用同一规范化 window。
- 过程性评价 JSON：`process-assessment/page.tsx` -> `/api/proxy/classrooms/:id/process-assessment`。
  - 对应后端：`GET /api/classrooms/:classroomId/process-assessment`。
  - 行覆盖率、当前页平均覆盖率与 AI 请求成功率固定按 ratio 展示；rubric 权重按 ratio 转为满分贡献，score 与平均得分保持分数展示，不再转换。
  - 页头名称辅助读取一次 `GET classrooms/:classroomId`，与现有加载并行，经 `toClassroomDetailResponse` 取名；独立有限超时及失败占位，不改变统计主体错误处理。
  - window 适配：前端仅接受精确的 `7d | 30d | all`；省略、空值、`term`、`24h`、大小写或空白变体及其他未知值统一沿用 `parseEnum` 回落为 `all`，不设 term 特判、不 trim 或转换大小写。重复 window 沿用 `getSingleSearchParam` 取首值；JSON 与 CSV 共用同一解析后的 window。
  - 注意：`excludedTaskIds` 仅适配为 URL 查询条件；直接消费后端任务维度指标（`iteratedTasksCount/aiRequestedTasksCount/aiSucceededTasksCount/avgWarnItems`），不重算评分。
  - 响应与行适配见 [Backend DTO Process Assessment](./handoff-backend-dto-cheatsheet.md#process-assessment)：列表及分页只取顶层 `items/page/limit/total`，不再读取 `rows/data/pagination`，空 `items` 不救援、缺失或非法分页保持 `undefined`。表格的行标识、姓名、进度率、风险与问题摘要分别只取正式 `studentId/studentName/submittedTasksRate/riskLevel/topTags`，不以旧字段或任务数量补足；未知显示、数字字符串与风险格式、真实 0、空标签、行序和原对象引用保持。
- 过程性评价 CSV：`process-assessment/page.tsx` -> `buildProxyPath("classrooms/:id/process-assessment.csv")`。
  - 对应后端：`GET /api/classrooms/:classroomId/process-assessment.csv`。
  - 注意：下载链接继续走 `/api/proxy/**`，与页面 JSON 使用同一排除口径；CSV 字段由后端导出实现决定。
- AI 反馈介入成效分析总览：`ai-learning-analytics/page.tsx` -> `client.fetchJson("classrooms/:id/ai-learning-analytics?..." )` -> `/api/proxy/classrooms/:id/ai-learning-analytics` -> `GET /api/classrooms/:classroomId/ai-learning-analytics`。
  - 使用 `toAiLearningAnalyticsOverviewResponse`；query 仅为 `window=all|7d|30d` 与逗号分隔的 `excludedTaskIds`，不携带学生搜索、筛选或分页参数。
  - 三类响应方法学均为 V1.2，`scope/sampleUnit/qualityProxy` 标识保持；mapper 直接映射班级与任务计数、作品更新率、evidenceSummary 和后端 nullable 指标，未知不补0。
- AI 反馈介入成效分析学生列表：同一 `page.tsx` -> `/api/proxy/classrooms/:id/ai-learning-analytics/students` -> `GET /api/classrooms/:classroomId/ai-learning-analytics/students`。
  - 使用 `toAiLearningAnalyticsStudentsResponse`；与总览传递相同 `window/excludedTaskIds`，另固定 `limit=100` 并从 URL 传 `page/q/overallOutcome/engagementStatus`；后三项为 AND 语义，后端先搜索筛选再分页。
  - 响应映射 `context/methodology/total/activeStudentsTotal/filters/items`：`total` 是筛选后总数，`activeStudentsTotal` 是全部 ACTIVE 学生数，`filters` 是后端规范化回显；参与阶段使用更新后的后端枚举。
- AI 反馈介入成效分析学生详情：`ai-learning-analytics/students/[studentId]/page.tsx` -> `/api/proxy/classrooms/:id/ai-learning-analytics/students/:studentId` -> `GET /api/classrooms/:classroomId/ai-learning-analytics/students/:studentId`。
  - 使用 `toAiLearningAnalyticsStudentDetailResponse`；后端请求只传 `window/excludedTaskIds`，URL 中的 `page/q/overallOutcome/engagementStatus` 仅用于返回班级分析时恢复列表状态，绝不传给详情接口。
  - taskPoint 适配基线、比较端点、最新版本、较新未比较标记和稳定原因；null 与未知来源/模型保留，版本链接只使用后端对应 submissionId 及课堂上下文，不从 attemptNo 猜测提交。公开形状与值域见 [Backend DTO Analytics](./handoff-backend-dto-cheatsheet.md#ai-learning-analytics)。
- 三个 Analytics mapper 直接消费正式根对象，不再解包 `data`；根字段缺失、非法或为空时不从 `data` 补足，只有旧包装时沿既有缺字段规则降级，不新增整页协议错误。业务投影只消费 `detailedOutcome/overallOutcome/engagementStatus` 等现行字段，字段合同见 [Backend DTO Analytics](./handoff-backend-dto-cheatsheet.md#ai-learning-analytics)；raw 严格引用原根对象，不修改输入或清洗 raw，旧 `data` 可继续保留于 raw 中。
- 上述三条正式请求全部由 `fetchJson` 经 `/api/proxy/**` 发出；前端只适配后端返回值与枚举，本模块所有 nullable 比率/均值保持 null，真实0保留为0，不调用通用必需数字适配补零。不重算基线/终点、issueLoad、`detailedOutcome`、`overallOutcome`、`engagementStatus`、rate 分母或任何聚合指标。
- 教学快照预检：`export/snapshot/page.tsx` -> `/api/proxy/classrooms/:id/export/snapshot`。
  - 对应后端：`GET /api/classrooms/:classroomId/export/snapshot`。
  - window 适配：前端仅接受精确的 `7d | 30d`，页面默认 `7d`；省略、空值、`term`、`24h`、`all`、大小写或空白变体及其他未知值统一沿用 `parseEnum` 回落为 `7d`，不设旧值特判、不 trim 或转换大小写。重复 window 沿用 `getSingleSearchParam` 取首值。
  - 请求始终显式发送解析后的 window；后端省略窗口时的默认值及响应合同见 [Backend DTO Snapshot](./handoff-backend-dto-cheatsheet.md#classroom-export-snapshot)。
  - 预检只投影根 `meta/summary`，notes 仅取 `meta.notes` 字符串数组，不从 `data` 或单字符串补足；不再投影无用的顶层 `classroomId/window`。空正式分组和提示保持为空，合法 notes 原文与顺序、对象分组引用及根 raw 保持；只有旧包装时仍保留 raw 诊断，不新增整页协议错误。

## 4) 高风险调用边界

- 不绕过 `/api/proxy/**` 直连后端 origin；新增前端 API 调用优先使用 `client.ts` / `browser-client.ts`。
- 不在业务组件里重复实现 fetch 错误解析；展示层复用 `error-presenter.ts` 或现有错误态。
- 不把 URL query 透传数据当 submission detail 主体数据源；主体以 `GET /api/learning-tasks/submissions/:id` 为准。
- 不在前端重算过程性评价评分、CSV 字段、Enrollment 权限或班级归属；这些由后端接口判定。
- 不在前端持久化 `excludedTaskIds`；过程性评价排除任务仅作为 URL 查询条件。
- AI 反馈介入成效分析同样不持久化 `excludedTaskIds`，且不得用当前学生分页结果重算班级摘要；所有可空反馈条目负荷、比率及均值必须保持 `number | null`，较新未比较的未知标记保持 null。
- 不用模板当前 `PUBLISHED/ARCHIVED` 状态阻断既有 classroomTask 的学生运行态；消费后端 `participationStatus`。
- 后端 debug/ops 与产品 AI request 保持独立调用边界；当前前端没有正式 debug/ops 调用链。

## 5) 维护规则

- 新增前端 API helper、BFF proxy 变化、页面真接口接入时，同步更新本文的 helper 地图与业务域调用地图。
- 后端接口契约变化时，先更新 Backend API / DTO Owner；仅当前端调用、请求/响应适配或集成边界变化时同步本文。
- 页面用途、完成度与导航交互变化更新 Route Map；不影响集成时本文保持 zero diff。
- 组件职责、按钮/菜单位置和展示标签变化更新 Component / Route Owner；本文只保留 API 对接相关边界。
- 若调用链无法从当前代码确认，本文应标注“需以当前代码核对”，不要补写猜测路径。
