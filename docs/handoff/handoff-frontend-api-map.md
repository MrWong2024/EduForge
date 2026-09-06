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
- 错误处理：Server 侧抛 `FetchJsonError`，Client 侧抛 `BrowserFetchJsonError`；展示层通过 `error-presenter.ts` 提取后端 `message/code/detail`。
- `app/api/_demo/**` 与 `/_demo/**` 是 demo 沙箱，不参与正式 Teacher/Student 主链路。

## 2) API client / helper 文件地图

| 文件 | 主要职责 | 典型调用方 | 注意点 |
|---|---|---|---|
| `frontend/lib/api/client.ts` | Server/RSC fetchJson；拼 `/api/proxy/**`；补 inbound cookie；默认 `no-store` | `app/teacher/**/page.tsx`、`app/student/**/page.tsx`、`lib/auth/session.ts` | Server 侧需要当前 request origin 时可传 `origin` |
| `frontend/lib/api/browser-client.ts` | Client Component fetchJson；拼 `/api/proxy/**`；`credentials: include` | 表单、按钮、生命周期 action 组件 | 不直接拼后端绝对 URL |
| `frontend/app/api/proxy/[...path]/route.ts` | BFF proxy；转发 method/body/header 到后端 `/api/**` | 所有正式业务请求 | 唯一正式后端代理入口；由 `FRONTEND_BACKEND_ORIGIN` 控制上游 |
| `frontend/lib/api/error-presenter.ts` | 从错误 payload 提取 `message/code` 并拼展示文案 | 表单、页面错误态 | 不改变后端错误语义，只做展示整理 |
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
  - 调用方：`app/teacher/layout.tsx`、`app/student/layout.tsx`。
  - 注意：Teacher / Student role gate 的登录态锚点。
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
- 班级创建/编辑：`CreateClassroomForm`、`EditClassroomForm` -> `/api/proxy/classrooms*` -> `POST/PATCH /api/classrooms*`。
  - 调用页面：`/teacher/classrooms*`。
- 班级生命周期：`ClassroomLifecycleActions` -> `/api/proxy/classrooms/:id` -> `PATCH/DELETE /api/classrooms/:id`。
  - 调用页面：`/teacher/classrooms`。
  - 注意：`CLASSROOM_NOT_EMPTY` 只做展示；Enrollment 历史由后端判定。
- 班级成员：`members/page.tsx`、`RemoveStudentButton` -> `/api/proxy/classrooms/:id/students*`。
  - 对应后端：`GET /api/classrooms/:id/students`、`POST /api/classrooms/:id/students/:uid/remove`。
  - 注意：成员列表使用正式后端读源，禁止回退到 `studentIds`。

### 3.3 Teacher 任务 / 提交 / 反馈

- 任务模板列表：`/teacher/tasks/page.tsx` -> `/api/proxy/learning-tasks/tasks?...` -> `GET /api/learning-tasks/tasks`。
  - 注意：`scope/courseLabel/status/knowledgeModule/stage/page` 由 URL 驱动并透传后端。
- 任务模板创建：`CreateLearningTaskForm` -> `/api/proxy/learning-tasks/tasks` -> `POST /api/learning-tasks/tasks`。
  - 注意：初始 `status` 遵循后端创建 DTO；创建与后续生命周期请求不混用。
- 任务模板编辑/生命周期：`EditLearningTaskForm` -> `/api/proxy/learning-tasks/tasks/:id*`。
  - 对应后端：`GET/PATCH /api/learning-tasks/tasks/:id`、`POST /publish`、`POST /archive`。
  - 注意：内容更新与生命周期采用各自后端接口，普通保存不构造状态流转；权限与生命周期由后端最终校验。
- 班级发布候选：`PublishClassroomTaskForm` -> `/api/proxy/classrooms/:id/publishable-task-templates`。
  - 对应后端：`GET /api/classrooms/:id/publishable-task-templates`。
  - 注意：模板可见性、发布资格及本班已发布排除由后端候选接口决定，前端不自行伪造候选全集。
- 班级任务实例：`/teacher/classrooms/:id/tasks/page.tsx` + 发布/生命周期/编辑组件 -> `/api/proxy/classrooms/:id/tasks*`。
  - 对应后端：`GET/POST/PATCH /api/classrooms/:id/tasks*` 与 `/status`。
  - 注意：实例配置与状态动作分开发送；前端只请求后端支持的状态动作，不构造额外 transition。
- 课堂任务提交列表：`submissions/page.tsx` -> `/api/proxy/classrooms/:cid/tasks/:ctid/submissions`。
  - 对应后端：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`。
  - 注意：只按 `classroomTaskId` 读取，不用 `taskId` 兜底过滤。
- 提交详情和反馈：Teacher/Student submission pages + feedback forms -> `/api/proxy/learning-tasks/submissions/:id*`。
  - 对应后端：submission detail、feedback list、teacher feedback create/update。
  - 注意：正式 detail API `GET /api/learning-tasks/submissions/:id` 是主体 SoT；URL query 仅用于导航上下文及正式 detail 缺字段时的少量展示兼容 fallback（包括 Student 页的 AI 状态展示），不得覆盖已有权威字段，也不作为权威业务数据源。

### 3.4 Student 学习链路

- 学生看板：`student/dashboard/page.tsx` -> `/api/proxy/classrooms/mine/dashboard` -> `GET /api/classrooms/mine/dashboard`。
  - 注意：完成状态消费后端 `completionStatus`，不从 AI 状态或历史提交二次推断。
- 加入班级：`JoinClassroomForm` -> `/api/proxy/classrooms/join` -> `POST /api/classrooms/join`。
  - 注意：只提交 joinCode，入班权限与重复入班由后端判定。
- 学生任务详情：`student/classrooms/:cid/tasks/:ctid/page.tsx` -> `/api/proxy/classrooms/:cid/tasks/:ctid/my-task-detail`。
  - 对应后端：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`。
  - 注意：消费 `participationStatus`；模板当前状态不作为前端阻断依据。
- 学生提交：`SubmissionForm` -> `/api/proxy/classrooms/:cid/tasks/:ctid/submissions`。
  - 对应后端：`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`。
  - 注意：迟交、冷却、Enrollment、课堂任务状态由后端最终校验。
- 学生 submission detail：`student/submissions/:id/page.tsx` -> `/api/proxy/learning-tasks/submissions/:id*`。
  - 对应后端：submission detail、feedback list。
  - 注意：状态驱动刷新只复用现有读源，不新增旁路接口。

### 3.5 AI Feedback / 报表 / 导出

- AI Feedback 产品请求：`RequestAiFeedbackButton` -> `/api/proxy/learning-tasks/submissions/:id/ai-feedback/request`。
  - 对应后端：`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`。
  - 注意：request 只确保 job；执行由 worker/processor 消费。
- 班级周报：`weekly-report/page.tsx` -> `/api/proxy/classrooms/:id/weekly-report`。
  - 对应后端：`GET /api/classrooms/:classroomId/weekly-report`。
  - 注意：窗口与公开数据见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#weekly-report)，前端消费后端聚合结果。
- 课程总览：`courses/:courseId/overview/page.tsx` -> `/api/proxy/courses/:courseId/overview`。
  - 对应后端：`GET /api/courses/:courseId/overview`。
- 学习轨迹 / 课堂复盘 / AI 指标：三件套 Server pages -> `/api/proxy/classrooms/:cid/tasks/:ctid/{learning-trajectory,review-pack,ai-metrics}`。
  - 对应后端：三个课堂任务聚合接口。
- 过程性评价 JSON：`process-assessment/page.tsx` -> `/api/proxy/classrooms/:id/process-assessment`。
  - 对应后端：`GET /api/classrooms/:classroomId/process-assessment`。
  - window 适配：前端接受 `term | 7d | 30d | all`，其中 `term` 仅用于旧链接兼容并可传给后端；`24h` 与其他未知或非法值统一通过现有 query parser 规范化为默认 `all`。JSON 与 CSV 共用同一解析后的 window。
  - 注意：`excludedTaskIds` 仅适配为 URL 查询条件；直接消费后端任务维度指标（`iteratedTasksCount/aiRequestedTasksCount/aiSucceededTasksCount/avgWarnItems`），不重算评分。
- 过程性评价 CSV：`process-assessment/page.tsx` -> `buildProxyPath("classrooms/:id/process-assessment.csv")`。
  - 对应后端：`GET /api/classrooms/:classroomId/process-assessment.csv`。
  - 注意：下载链接继续走 `/api/proxy/**`，与页面 JSON 使用同一排除口径；CSV 字段由后端导出实现决定。
- AI 反馈介入成效分析总览：`ai-learning-analytics/page.tsx` -> `client.fetchJson("classrooms/:id/ai-learning-analytics?..." )` -> `/api/proxy/classrooms/:id/ai-learning-analytics` -> `GET /api/classrooms/:classroomId/ai-learning-analytics`。
  - 使用 `toAiLearningAnalyticsOverviewResponse`；query 仅为 `window=all|7d|30d` 与逗号分隔的 `excludedTaskIds`，不携带学生搜索、筛选或分页参数。
  - 方法学 `scope` 仍为 `AI_FEEDBACK_INTERVENTION_V1`，新增 `version=AI_FEEDBACK_INTERVENTION_V1_1`；mapper 直接映射班级与任务级精细计数和后端 rate。
- AI 反馈介入成效分析学生列表：同一 `page.tsx` -> `/api/proxy/classrooms/:id/ai-learning-analytics/students` -> `GET /api/classrooms/:classroomId/ai-learning-analytics/students`。
  - 使用 `toAiLearningAnalyticsStudentsResponse`；与总览传递相同 `window/excludedTaskIds`，另固定 `limit=100` 并从 URL 传 `page/q/overallOutcome/engagementStatus`；后三项为 AND 语义，后端先搜索筛选再分页。
  - 响应映射 `context/total/activeStudentsTotal/filters/items`：`total` 是筛选后总数，`activeStudentsTotal` 是全部 ACTIVE 学生数，`filters` 是后端规范化回显。
- AI 反馈介入成效分析学生详情：`ai-learning-analytics/students/[studentId]/page.tsx` -> `/api/proxy/classrooms/:id/ai-learning-analytics/students/:studentId` -> `GET /api/classrooms/:classroomId/ai-learning-analytics/students/:studentId`。
  - 使用 `toAiLearningAnalyticsStudentDetailResponse`；后端请求只传 `window/excludedTaskIds`，URL 中的 `page/q/overallOutcome/engagementStatus` 仅用于返回班级分析时恢复列表状态，绝不传给详情接口。
- 三个 mapper 直接消费 `detailedOutcome/overallOutcome/engagementStatus`；legacy `outcome/growthTrend/stable*Count` 继续映射并保留在 raw/兼容类型中。
- 上述三条正式请求全部由 `fetchJson` 经 `/api/proxy/**` 发出；前端只适配后端返回值与枚举，结合可比计数识别无可比数据并保留 null，不重算 anchor、配对、issueLoad、`detailedOutcome`、`overallOutcome`、`engagementStatus`、rate 分母或任何聚合指标。
- 教学快照预检：`export/snapshot/page.tsx` -> `/api/proxy/classrooms/:id/export/snapshot`。
  - 对应后端：`GET /api/classrooms/:classroomId/export/snapshot`。
- Demo 沙箱：`_demo` pages -> native fetch `/api/_demo/**`。
  - 对应后端：无；这是前端内存 route。
  - 注意：不经过 BFF proxy，也不作为正式 API 接入口。

## 4) 高风险调用边界

- 不绕过 `/api/proxy/**` 直连后端 origin；新增前端 API 调用优先使用 `client.ts` / `browser-client.ts`。
- 不在业务组件里重复实现 fetch 错误解析；展示层复用 `error-presenter.ts` 或现有错误态。
- 不把 URL query 透传数据当 submission detail 主体数据源；主体以 `GET /api/learning-tasks/submissions/:id` 为准。
- 不在前端重算过程性评价评分、CSV 字段、Enrollment 权限或班级归属；这些由后端接口判定。
- 不在前端持久化 `excludedTaskIds`；过程性评价排除任务仅作为 URL 查询条件。
- AI 反馈介入成效分析同样不持久化 `excludedTaskIds`，且不得用当前学生分页结果重算班级摘要；个人可空问题负荷必须保持 `number | null`。
- 不用模板当前 `PUBLISHED/ARCHIVED` 状态阻断既有 classroomTask 的学生运行态；消费后端 `participationStatus`。
- 后端 debug/ops 与产品 AI request 保持独立调用边界；当前前端没有正式 debug/ops 调用链。
- 不把 `/_demo/**` 或 `/api/_demo/**` 的内存接口当正式 API 接入口。

## 5) 维护规则

- 新增前端 API helper、BFF proxy 变化、页面真接口接入时，同步更新本文的 helper 地图与业务域调用地图。
- 后端接口契约变化时，先更新 Backend API / DTO Owner；仅当前端调用、请求/响应适配或集成边界变化时同步本文。
- 页面用途、完成度与导航交互变化更新 Route Map；不影响集成时本文保持 zero diff。
- 组件职责、按钮/菜单位置和展示标签变化更新 Component / Route Owner；本文只保留 API 对接相关边界。
- 若调用链无法从当前代码确认，本文应标注“需以当前代码核对”，不要补写猜测路径。
