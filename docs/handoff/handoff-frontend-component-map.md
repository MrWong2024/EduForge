# 前端组件/模块职责地图（Component Map）

目标：让新会话快速知道“改哪里、不要改哪里”。

## 1) Shell 层（页面外壳与导航）

| 模块 | 文件 | 职责 | 不要在哪改 |
|---|---|---|---|
| TeacherShell | `components/layout/TeacherShell.tsx` | 教师端顶栏、主导航、登出入口 | 不要在业务页面重复写教师导航 |
| StudentShell | `components/layout/StudentShell.tsx` | 学生端顶栏、主导航、登出入口 | 不要在业务页面重复写学生导航 |
| Teacher Gate | `app/teacher/layout.tsx` | `requireRole("TEACHER")` + 403 fallback | 不要在每个 teacher 页面重复做 role gate |
| Student Gate | `app/student/layout.tsx` | `requireRole("STUDENT")` + 403 fallback | 不要在每个 student 页面重复做 role gate |

## 2) Blocks（通用展示块）

| 组件 | 文件 | 职责 | 不要在哪改 |
|---|---|---|---|
| PageHeader | `components/blocks/PageHeader.tsx` | 页面标题/描述/右侧 actions 标准结构 | 不要在每个页面自定义不同标题骨架 |
| EmptyState | `components/blocks/EmptyState.tsx` | 空态统一视觉与动作插槽 | 不要各页自写风格不一空态 |
| ErrorState | `components/blocks/ErrorState.tsx` | 错误态统一展示（含 401/403/404/500 默认文案） | 不要在业务组件散落硬编码错误块 |
| Tabs | `components/blocks/Tabs.tsx` | 任务工作区 tab 导航 | 不要在三件套页面重复 tab 样式 |
| FloatingMoreMenu | `components/blocks/FloatingMoreMenu.tsx` | 生命周期“更多”菜单的轻量浮层基础组件（Portal + fixed） | 不要在业务组件内重复实现 Portal 定位、视口边界钳制和外部点击/Esc/滚动关闭逻辑 |

## 3) Teacher 交互组件

| 组件 | 文件 | 真实 API | 作用边界 |
|---|---|---|---|
| CreateCourseForm | `components/teacher/CreateCourseForm.tsx` | `POST courses` | 只负责建课表单与成功跳转；支持可选 `courseLabel`（课程分类）录入，候选项复用 `lib/learning-tasks/course-labels.ts` 单一来源；学期 placeholder 由前端按当前月份动态生成示例，不自动填充值 |
| CourseLifecycleActions | `components/teacher/CourseLifecycleActions.tsx` | `PATCH courses/:id`、`DELETE courses/:id` | 只负责课程生命周期动作菜单（“更多”次级菜单）：`ACTIVE` 显示“归档/删除”、`ARCHIVED` 显示“恢复/删除”；菜单通过 `FloatingMoreMenu` 以 Portal 浮层渲染，脱离表格滚动容器；删除为危险项且保留二次确认；删除失败命中 `COURSE_NOT_EMPTY` 时显示明确中文提示；动作成功后 `router.refresh()`，保持当前课程列表 query 视图 |
| EditCourseForm | `components/teacher/EditCourseForm.tsx` | `PATCH courses/:id` | 只负责课程基础信息编辑（`code/name/term/courseLabel`）与保存；`courseLabel` 候选项复用 `lib/learning-tasks/course-labels.ts` 单一来源，支持清空 |
| CreateClassroomForm | `components/teacher/CreateClassroomForm.tsx` | `POST classrooms` | 只负责建班表单，不负责班级列表加载 |
| EditClassroomForm | `components/teacher/EditClassroomForm.tsx` | `PATCH classrooms/:id`、`POST classrooms/:id/archive` | 只负责班级基础信息编辑（当前仅 `name`）与轻量管理操作；所属课程只读展示使用 `ClassroomResponse.course` 摘要，异常缺失时才弱化显示 `courseId` 兜底；`status/joinCode` 只读展示；`ACTIVE` 班级可二次确认后归档并回班级看板刷新，`ARCHIVED` 班级仅显示已归档提示；不提供恢复或删除动作 |
| ClassroomLifecycleActions | `components/teacher/ClassroomLifecycleActions.tsx` | `PATCH classrooms/:id`、`DELETE classrooms/:id` | 只负责班级生命周期动作菜单（“更多”次级菜单）：`ACTIVE` 显示“归档/删除”、`ARCHIVED` 显示“恢复/删除”；菜单通过 `FloatingMoreMenu` 以 Portal 浮层渲染，脱离表格滚动容器；删除为危险项且保留二次确认；删除失败命中 `CLASSROOM_NOT_EMPTY` 时显示明确中文提示；动作成功后 `router.refresh()`，保持当前列表 query 视图 |
| CreateLearningTaskForm | `components/teacher/CreateLearningTaskForm.tsx` | `POST learning-tasks/tasks` | 只负责模板创建（核心字段 + 可选 `courseLabel` + `visibility` 单选 + 基础 rubric 配置，四维中文展示口径复用 `lib/ui/rubric.ts`）；创建页不暴露 `status` 下拉，而是通过“保存为草稿 / 发布模板”两个动作分别提交 `status=DRAFT/PUBLISHED`；不提供 `ARCHIVED` 创建入口；不负责班级实例发布 |
| EditLearningTaskForm | `components/teacher/EditLearningTaskForm.tsx` | `PATCH learning-tasks/tasks/:id`、`POST learning-tasks/tasks/:id/publish`、`POST learning-tasks/tasks/:id/archive` | 只负责模板编辑/只读查看（核心字段 + 可选 `courseLabel` + `visibility` + 只读状态展示 + rubric，四维中文展示口径复用 `lib/ui/rubric.ts`）；普通保存只提交内容字段，不再提交 `status`；非作者共享模板仅可读并基于 `publisher` 显示模板发布者来源；作者打开 `DRAFT` 模板时可点击“发布模板”，打开 `PUBLISHED` 模板时可点击“归档模板”，两者均二次确认后调用动作接口并 `router.refresh()`；作者打开 `ARCHIVED` 模板时表单只读、不发 PATCH、不显示保存/发布/归档/恢复动作，仅展示归档说明；当后端仍返回“已被课堂任务引用的 `PUBLISHED` 模板不能改回 `DRAFT`”旧错误时，组件保留中文兜底收口；底部返回入口优先使用 `returnTo` 回到原模板列表上下文（缺失/非法时回退 `/teacher/tasks`） |
| LearningTaskFilters | `components/teacher/LearningTaskFilters.tsx` | `GET learning-tasks/tasks?scope=...&courseLabel=...&status=...&knowledgeModule=...&stage=...&page=...&limit=20`（通过 URL query 触发服务端真实查询） | 负责模板层视图与筛选（`scope/status/knowledgeModule/stage/courseLabel` 全量 query 驱动）与列表呈现（含 `visibility` 轻量标签、非作者模板操作边界、基于 `publisher` 的模板发布者来源）；作者自己的 `DRAFT/PUBLISHED` 模板显示“编辑”，作者自己的 `ARCHIVED` 模板仅显示“查看”，不再提供“恢复为草稿”；非作者任意状态都只显示“查看”；筛选变化统一重置 `page=1`，并使用标准分页（上一页/下一页）；编辑/查看入口会附带 `returnTo`（当前列表完整 URL，天然含页码与筛选）以保留回跳上下文；默认排序在“当前页结果渲染前”按 scope 策略执行；不发起模板发布/归档请求 |
| PublishClassroomTaskForm | `components/teacher/PublishClassroomTaskForm.tsx` | `GET classrooms/:id/publishable-task-templates`（首屏由页面传入 `page=1&limit=50`，后续页由组件按当前筛选请求） + `POST classrooms/:id/tasks` | 只负责选择“当前教师可见且已发布”的模板（我的 + 可见共享）并发布班级实例；筛选控件（`courseLabel`、`onlyMine`、`knowledgeModule`、`stage`）通过 URL query 触发后端实时重查；`courseLabel` 下拉选项复用统一标准课程分类列表，不依赖当前候选结果动态倒推；支持“加载更多”追加候选（非完整分页器）；筛选变化时重置为第一页结果；候选模板列表与已选模板摘要会基于 `publisher` 对非本人模板显示发布者来源，其中已选摘要的描述使用保留换行的固定高度滚动说明框展示；后端负责排除“当前班级已发布过”的模板；可配置 `dueAt/allowLate/maxAttempts`；不负责创建/编辑模板 |
| ClassroomTaskLifecycleActions | `components/teacher/ClassroomTaskLifecycleActions.tsx` | `PATCH classrooms/:classroomId/tasks/:classroomTaskId/status` | 只负责课堂任务实例状态标签与状态流动作（`ACTIVE/CLOSED/RECALLED` 展示；`ACTIVE` 可关闭、`CLOSED` 可恢复提交、`RECALLED` 无动作）；状态列不常驻展示解释性 hint，后果说明保留在确认弹窗；恢复提交仅恢复状态，不自动修改 `dueAt/allowLate/maxAttempts`；不做物理删除，不承担发布表单逻辑 |
| EditClassroomTaskForm | `components/teacher/EditClassroomTaskForm.tsx` | `PATCH classrooms/:classroomId/tasks/:classroomTaskId` | 只负责课堂任务实例级配置编辑（`dueAt/allowLate/maxAttempts`）；以列表行内展开表单承载编辑；仅 `ACTIVE/CLOSED` 显示入口并允许提交，`RECALLED` 不显示入口；不修改模板本体、不修改状态流 |
| PublishTaskStatusButton | `components/teacher/PublishTaskStatusButton.tsx` | `POST learning-tasks/tasks/:id/publish` | 仅做 task 发布状态操作；当前教师 classroomTask 详情页已不再使用该组件，模板生命周期统一在 `/teacher/tasks/[taskId]/edit` 处理 |
| RemoveStudentButton | `components/teacher/RemoveStudentButton.tsx` | `POST classrooms/:id/students/:uid/remove` | 仅做移除动作，不负责成员列表 |
| TeacherFeedbackForm | `components/teacher/TeacherFeedbackForm.tsx` | `POST learning-tasks/submissions/:id/feedback` | 仅做教师反馈创建；新增字段口径为 `type/severity/message/suggestion/tags`，其中 `type/severity` 复用前端统一反馈选项；`tags` 可选，不选时由后端归一化为 `other`，前端只做规则提示，不改变原始枚举展示；`scoreHint` 后端响应兼容但前端不提供新增入口 |
| TeacherFeedbackHistory | `components/teacher/TeacherFeedbackHistory.tsx` | - | 仅负责教师提交详情页反馈历史展示与编辑态切换；只对 `source=TEACHER` 且有 `id` 的反馈显示“修改”，AI/SYSTEM 反馈保持只读；同一时间只展开一个编辑表单 |
| TeacherFeedbackEditForm | `components/teacher/TeacherFeedbackEditForm.tsx` | `PATCH learning-tasks/submissions/:submissionId/feedback/:feedbackId` | 仅负责单条教师反馈原地编辑（`type/severity/message/suggestion/tags`）；`tags` 可选，不选时由后端归一化为 `other`，前端只做规则提示，不改变原始枚举展示；请求通过 `browser-client.fetchJson` 走 `/api/proxy/**`；保存成功后 `router.refresh()` 并退出编辑态；400/403/404/5xx 分别显示明确中文摘要与后端 detail；`scoreHint` 后端响应兼容但前端不展示、不提交、不编辑 |

## 4) Student 交互组件

| 组件 | 文件 | 真实 API | 作用边界 |
|---|---|---|---|
| JoinClassroomForm | `components/student/JoinClassroomForm.tsx` | `POST classrooms/join` | 仅处理 joinCode 入班 |
| SubmissionForm | `components/student/SubmissionForm.tsx` | `POST classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 仅处理提交动作与迟交错误分流；`codeText` 输入区提供语言无关的多文件粘贴格式提示，明确单文件无需 `FILE` 标记，并展示推荐标准格式示例；不额外根据任务模板当前 `PUBLISHED/ARCHIVED` 状态做前端阻断，也不做上传/结构化文件提交 |
| RequestAiFeedbackButton | `components/student/RequestAiFeedbackButton.tsx` | `POST learning-tasks/submissions/:submissionId/ai-feedback/request` | 仅处理 request AI 行为 |
| AiProcessingHint | `components/student/AiProcessingHint.tsx` | - | 统一 `PENDING/RUNNING` 提示文案 |
| SubmissionAutoRefresh | `components/student/SubmissionAutoRefresh.tsx` | `router.refresh()`（复用页面现有读源链路） | 用于学生提交详情页与学生任务详情页的状态驱动自动刷新；支持单状态或状态集合输入；`PENDING/RUNNING` 快速、`FAILED` 慢速；活跃态结束后有一次最小收尾刷新；页面失焦/不可见暂停；同页实例内防重叠 |

## 5) 课堂任务上下文组件

| 组件 | 文件 | 职责 |
|---|---|---|
| TaskContextHeader | `components/classroomTask/TaskContextHeader.tsx` | 在 `teacher/.../tasks/[classroomTaskId]/*` 下统一显示任务上下文与三件套 tabs |

边界补充：

- `TaskContextHeader` 只服务 Teacher 的 classroomTask 工作区，不要把 Student 页或非 classroomTask 页强行复用进来。

## 6) API/认证/路由基础模块（lib）

| 模块 | 文件 | 职责 | 不要在哪改 |
|---|---|---|---|
| Server API Client | `lib/api/client.ts` | SSR/RSC 请求，自动拼 `/api/proxy/**`，服务端注入 cookie | 不要在 Server Component 直接拼后端绝对 URL |
| Browser API Client | `lib/api/browser-client.ts` | Client 组件请求，统一 `/api/proxy/**` 与错误类型 | 不要在业务组件直接写 `fetch('/api/proxy/...')` 重复逻辑 |
| Error Presenter | `lib/api/error-presenter.ts` | detail 提取与错误描述拼接 | 不要各表单重复手写 message/code 拼接 |
| Teacher Types Adapter | `lib/api/types-teacher.ts` | 教师域 payload 解析与容错映射 | 不要在页面直接散写深层字段访问 |
| Student Types Adapter | `lib/api/types-student.ts` | 学生域 payload 解析与容错映射 | 同上 |
| Session/Auth | `lib/auth/session.ts` + `lib/auth/role-home.ts` | `users/me` 探针、role 判断、role-home | 不要在页面自定义角色跳转规则 |
| Paths | `lib/routes/paths.ts` | 路由常量与参数化路径（含模板页、模板编辑页、班级页到模板页上下文链路） | 不要在页面硬编码路径字符串 |
| UI Status | `lib/ui/status.ts` | AI 状态文案、通用错误摘要 | 不要各页散落不同状态文案口径 |
| Task Course Labels | `lib/learning-tasks/course-labels.ts` | 任务模板课程分类候选项、未分类口径、显示/归一化工具的前端单一来源 | 不要在表单、筛选器、列表展示处重复硬编码课程分类数组 |
| Task Template Visibility/Scope | `lib/learning-tasks/template-visibility-scope.ts` | 模板 `visibility`（`PRIVATE/SHARED`）与列表 `scope`（`mine/shared/all`）的前端单一来源（值域、显示文案、normalize） | 不要在页面、表单、筛选栏中散落魔法字符串 |
| Task Template List Sorting | `lib/learning-tasks/template-list-sorting.ts` | 任务模板列表默认排序单一来源：`mine` 最近更新优先，`shared` 先 `PUBLISHED` 再按时间，`all` 先我的模板再排他人共享 | 不要在 JSX 内散落多套 compare 逻辑 |
| UI Rubric | `lib/ui/rubric.ts` | rubric 四维中文映射统一入口（`RUBRIC_DIMENSION_LABELS`、`getRubricDimensionLabel`），供教师创建/编辑与学生任务详情评分标准维度展示复用 | 不要在页面内部各自维护本地 `labelMap` 或手写四份维度中文 |
| UI Format | `lib/ui/format.ts` | query/date/display/safeGet 工具 | 不要重复造相同 parse 函数 |
| Proxy Route | `app/api/proxy/[...path]/route.ts` | BFF 转发层，固定 Node runtime，method/body/header/set-cookie 透传 | 不要在业务页绕过 proxy 直连后端，也不要把业务逻辑塞进 proxy |

## 7) 当前“不要改错层”的关键提醒

- 需要改 API 口径时：先改 `lib/api/types-*` 与页面映射，不要直接在 JSX 深层访问原始 payload。
- 需要改权限行为时：优先看 `lib/auth/session.ts` 与 `app/{teacher,student}/layout.tsx`，不要在单页临时加 gate。
- 需要改三件套导航时：只改 `TaskContextHeader` 和 `paths.ts`，不要在三个页面分别维护链接。
- 需要改 AI 状态文案时：统一改 `lib/ui/status.ts` 与 `AiProcessingHint.tsx`，不要在每页复制文案。
- 需要改学习轨迹页（`teacher/.../learning-trajectory`）时：优先在页面内维护“摘要表 + 开关扩展区（attempts/tag details）”这一最小结构，不要引入独立复杂组件体系。
- 学习轨迹 attempts 扩展区中的“总反馈”默认读取 `attempt.feedbackCount`；`feedbackSummary.totalItems` 仅作 AI 摘要信息，不要混用口径。
- 需要改 submission detail 相关逻辑时：优先以稳定读源 `GET learning-tasks/submissions/:id` 为主，先看 `lib/api/types-student.ts`、`lib/api/types-teacher.ts` 与 Teacher/Student submission detail 页，不要把 query 透传当主数据源。
- 模板创建/编辑/rubric 配置属于模板层（`/teacher/tasks*`），不要回退到班级任务页。
- 班级任务页只负责班级实例发布与任务工作区管理，不要把模板维护能力混回 `PublishClassroomTaskForm`。
- 若任务仅是 handoff/manual checklist/docs 调整：不要顺手改业务组件或路由实现，先核对 `docs/handoff/*` 与当前代码是否一致再决定是否改代码。
