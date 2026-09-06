# 前端组件/模块职责地图（Component Map）

## 1) Scope / Owner

目标：让新会话快速知道“改哪里、不要改哪里”。文件路径以 `frontend/` 为基准，当前源码是最高事实源。

- 本文维护 component/module 的位置、responsibility、必要的 local state/composition、可复用行为与 non-responsibility/modification boundary。
- API helper、BFF、backend endpoint、request/response adaptation 与 integration boundary 由 [Frontend API Map](./handoff-frontend-api-map.md) 维护；本文只标明这些模块的修改落点，不维护接口清单、DTO 字段或 HTTP error matrix。
- route inventory、页面用途和 implementation state 由 [Route Map](./handoff-frontend-route-map.md) 维护；稳定 UX/视觉原则见 [Design Baseline](./handoff-frontend-design-baseline.md)，testing evidence 见 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。
- 组件中的动作可用性只描述其真实责任边界，不复制完整业务状态机或后端权限合同；前端不能伪造后端授权。

## 2) Shell 层（页面外壳与导航）

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| TeacherShell | `components/layout/TeacherShell.tsx` | 教师端顶栏、主导航、登出与账户入口的组合；不要在业务页重复教师导航 |
| StudentShell | `components/layout/StudentShell.tsx` | 学生端顶栏、主导航、登出与账户入口的组合；不要在业务页重复学生导航 |
| Teacher Gate | `app/teacher/layout.tsx` | 统一调用教师 role gate 并承载角色不匹配 UI；不要在每个页面重复 gate |
| Student Gate | `app/student/layout.tsx` | 统一调用学生 role gate 并承载角色不匹配 UI；不要在每个页面重复 gate |

## 3) Shared Blocks

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| PageHeader | `components/blocks/PageHeader.tsx` | 页面标题、描述与 actions 插槽的共享骨架 |
| EmptyState | `components/blocks/EmptyState.tsx` | 空态展示与动作插槽；页面提供业务含义，不各自复制视觉结构 |
| ErrorState | `components/blocks/ErrorState.tsx` | 错误态与默认展示文案；不改变后端错误语义 |
| Tabs | `components/blocks/Tabs.tsx` | 任务工作区 tab 导航展示；不在三件套页面重复实现 |
| FloatingMoreMenu | `components/blocks/FloatingMoreMenu.tsx` | 生命周期“更多”菜单的共享浮层基础：Portal 定位、视口边界与外部点击/Esc/滚动关闭；业务组件拥有菜单开关与具体动作，不在业务层复制浮层机制 |

## 4) Auth / Account

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| LoginForm | `components/auth/LoginForm.tsx` | 登录表单、提交/错误状态、合法来源回跳与 role-home 跳转及忘记密码入口；不拥有 forgot/reset 接口合同 |
| ForgotPasswordForm | `components/auth/ForgotPasswordForm.tsx` | 邮箱输入、空值校验、固定防枚举提示及发送倒计时状态；不推断邮箱是否存在，倒计时不替代后端安全边界 |
| ResetPasswordForm | `components/auth/ResetPasswordForm.tsx` | 重置链接 token 的消费、新密码与确认输入、前端校验、提交及成功导航；不将 token 持久化 |
| AccountPageContent | `components/account/AccountPageContent.tsx` | 教师/学生账户页共享组合：资料卡、改密表单与调用方提供的返回入口；登录态加载留在页面 |
| AccountProfileCard | `components/account/AccountProfileCard.tsx` | 只读展示当前用户身份资料；不提供资料编辑 |
| ChangePasswordForm | `components/account/ChangePasswordForm.tsx` | 当前/新/确认密码输入、局部校验与提交状态，成功清空输入并展示结果；会话失效由后端处理 |
| AccountNavEntry | `components/account/AccountNavEntry.tsx` | Shell 内当前用户身份摘要与账户入口；目标路径由调用方提供 |

## 5) Teacher 交互组件

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| CreateCourseForm | `components/teacher/CreateCourseForm.tsx` | 建课表单与成功导航，课程分类复用共享候选；学期示例不自动成为输入值 |
| CourseLifecycleActions | `components/teacher/CourseLifecycleActions.tsx` | 课程列表“更多”菜单、动作 pending/确认/结果状态，组合 FloatingMoreMenu；负责归档、恢复与删除，保留当前列表视图；空对象删除条件由后端判定 |
| EditCourseForm | `components/teacher/EditCourseForm.tsx` | 课程基础信息编辑与保存；课程分类复用共享候选并可清空，不承担列表加载 |
| CourseOverviewPage | `app/teacher/courses/[courseId]/overview/page.tsx` | 服务端加载、窗口/排序/分页及只读班级明细组合；页面摘要只汇总当前页，指标字段适配与含义遵循 API Owner，不把分页摘要当全课程统计 |
| CreateClassroomForm | `components/teacher/CreateClassroomForm.tsx` | 建班表单及局部输入/提交状态，不负责班级列表加载；名称示例不自动成为输入值 |
| EditClassroomForm | `components/teacher/EditClassroomForm.tsx` | 只编辑班级基础信息，当前可编辑字段为 `name`；所属课程、状态与加入码只读。通过班级更新能力保存并返回看板；不提供归档、恢复、删除或其他生命周期操作，生命周期动作归 ClassroomLifecycleActions |
| ClassroomLifecycleActions | `components/teacher/ClassroomLifecycleActions.tsx` | 班级列表生命周期“更多”菜单：ACTIVE 归档/删除，ARCHIVED 恢复/删除；拥有菜单、pending、确认与结果状态，组合 FloatingMoreMenu 并保留当前列表视图；删除限制由后端判定，不混入基础编辑表单 |
| CreateLearningTaskForm | `components/teacher/CreateLearningTaskForm.tsx` | 模板内容、课程分类、可见性及基础 rubric 配置；草稿/发布两种创建动作，无归档创建入口；复用 course-labels 与 UI Rubric，不负责课堂实例发布 |
| EditLearningTaskForm | `components/teacher/EditLearningTaskForm.tsx` | 模板内容编辑、rubric 与只读呈现；保存内容与发布/归档动作分离，管理动作确认和 pending。非作者、归档或未知状态只读，无恢复动作；保留合法列表返回上下文；不承担课堂实例设置 |
| LearningTaskFilters | `components/teacher/LearningTaskFilters.tsx` | 模板视图/筛选的 URL 状态、分页、列表展示与编辑/查看入口；保留列表返回上下文，筛选后回首屏；复用共享可见性和排序模块，不在当前页伪造完整候选或发起发布/归档 |
| PublishClassroomTaskForm | `components/teacher/PublishClassroomTaskForm.tsx` | 可见已发布模板的筛选、候选追加加载、选择状态与实例发布；筛选变化重置候选，课程分类复用共享候选；发布者来源与已选模板摘要由本组件展示。实例截止/迟交/次数设置属于此表单；不创建/编辑模板，不自行判定后端候选全集 |
| ClassroomTaskLifecycleActions | `components/teacher/ClassroomTaskLifecycleActions.tsx` | 实例状态展示、关闭/恢复提交及确认/请求状态；恢复只改变运行状态，不自动改截止、迟交或次数设置；RECALLED 无动作，不做物理删除或发布表单 |
| EditClassroomTaskForm | `components/teacher/EditClassroomTaskForm.tsx` | 列表行内展开、草稿输入与实例截止/迟交/次数设置保存；ACTIVE/CLOSED 可编辑，RECALLED 无入口；不修改模板或状态流 |
| PublishTaskStatusButton | `components/teacher/PublishTaskStatusButton.tsx` | 单一模板发布操作；当前 classroomTask 详情页不使用，模板生命周期入口留在模板层 |
| RemoveStudentButton | `components/teacher/RemoveStudentButton.tsx` | 单个成员移除及动作结果，不负责成员列表或成员关系判定 |
| TeacherFeedbackForm | `components/teacher/TeacherFeedbackForm.tsx` | 教师反馈创建输入与提交，复用统一反馈选项；标签可选，不提供 scoreHint 入口；字段合同与服务端归一化归 API Owner |
| TeacherFeedbackHistory | `components/teacher/TeacherFeedbackHistory.tsx` | 反馈历史组合与编辑态切换，同一时间只展开一个编辑表单；仅有 id 的教师反馈可修改，AI/SYSTEM 只读 |
| TeacherFeedbackEditForm | `components/teacher/TeacherFeedbackEditForm.tsx` | 单条教师反馈原地编辑、请求/错误状态、保存后退出编辑；与创建表单保持输入能力一致，不展示或编辑 scoreHint，不承担历史列表状态 |
| TeacherSubmissionDetailPage | `app/teacher/submissions/[submissionId]/page.tsx` | 服务端详情/反馈加载与页面组合、展示兼容及返回上下文；新增表单和历史编辑态由对应 feedback 组件负责，integration 规则见 Frontend API Map |

## 6) Teacher Analytics / Reports

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| ProcessAssessmentPage | `app/teacher/classrooms/[classroomId]/process-assessment/page.tsx` | URL 条件、服务端加载、分页、摘要、评分说明与 CSV 入口组合；使用 TaskExclusionPanel 的过程性评价模式及共享任务选项 helper；不重算后端评分或持久化排除条件 |
| AiLearningAnalyticsPage | `app/teacher/classrooms/[classroomId]/ai-learning-analytics/page.tsx` | Server 页面负责条件解析、总览/学生并行读取、局部错误、任务选项降级和分页；摘要、教学关注、图表、表格与筛选下沉至对应组件，不从学生分页重算摘要 |
| AiLearningAnalyticsStudentPage | `app/teacher/classrooms/[classroomId]/ai-learning-analytics/students/[studentId]/page.tsx` | Server 页面组合学生摘要、逐任务比较图与全任务明细，并恢复返回列表上下文；直接消费后端结果，列表状态不扩大详情请求范围 |
| TaskExclusionPanel | `components/teacher/TaskExclusionPanel.tsx` | 共享临时任务排除 Client Component，支持 process-assessment / ai-learning-analytics 模式；拥有 checkbox 草稿、应用/清空及导航 pending 状态，保留未显示的已选 ID；应用/清空回首屏并保持其他上下文，清空不携带当前 checkbox 选择；不持久化或修改教学数据 |
| AiLearningAnalyticsStudentFilters | `components/teacher/AiLearningAnalyticsStudentFilters.tsx` | 纯 Server 原生表单承载姓名/学号、总体结果与反馈参与阶段筛选；保留统计范围，应用/清空回首屏并定位学生分析区；不引入客户端过滤、滚动或独立 Browser 状态 |
| AiLearningAnalyticsSummary / AiLearningAnalyticsTeachingAttention | `components/teacher/AiLearningAnalyticsSummary.tsx` | 纯 Server 摘要展示后端 V1.1 四类计数与 rate；教学关注选择最低反馈后重提率、最多恶化样本、最高改善率任务，不生成评分或风险等级 |
| AiLearningAnalyticsTaskTable / AiLearningAnalyticsStudentsTable | `components/teacher/AiLearningAnalyticsTables.tsx` | 任务/学生表及四类结果分布展示，学生表组合总体结果、参与阶段与保留列表状态的详情入口；不做前端排序、过滤或排名 |
| AiLearningAnalyticsCharts | `components/teacher/AiLearningAnalyticsCharts.tsx` | 班级/个人复用原生 SVG 逐任务 before/after 坐标，班级另有 V1.1 四类堆叠分布；负责可访问的文字/颜色/纹理表达，不连接不同任务、不把 null 绘为 0，不重算后端可比样本分母 |
| AiLearningAnalyticsMethodologyPanel / AiLearningAnalyticsMetricGuide | `components/teacher/AiLearningAnalyticsMethodology.tsx` | 方法学版本与共享指标解释：改善、前后均无 ERROR/WARN、问题负荷未减少、恶化四类结果，总体结果非时间趋势、净变化可能抵消、参与阶段不代表态度/能力/风险；不承担业务计算 |

## 7) Student 交互组件

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| JoinClassroomForm | `components/student/JoinClassroomForm.tsx` | 加入码输入与入班动作，不判断后端入班权限 |
| SubmissionForm | `components/student/SubmissionForm.tsx` | 提交输入/请求状态及迟交错误呈现；多文件粘贴格式提示与示例由此维护，单文件无需 FILE 标记；不提供上传/结构化文件提交，不以模板当前状态自行阻断 |
| RequestAiFeedbackButton | `components/student/RequestAiFeedbackButton.tsx` | 请求 AI Feedback 的动作和局部结果状态；不承担任务处理或反馈计算 |
| AiProcessingHint | `components/student/AiProcessingHint.tsx` | 统一 AI 处理中提示；通用状态文案复用 UI Status |
| SubmissionAutoRefresh | `components/student/SubmissionAutoRefresh.tsx` | 学生任务/提交详情页状态驱动刷新，支持单状态或集合；处理中快刷、失败慢刷、活跃态结束一次收尾；失焦/不可见暂停，同页实例内防重叠，不建立旁路数据源 |
| StudentTaskDetailPage | `app/student/classrooms/[classroomId]/tasks/[classroomTaskId]/page.tsx` | 服务端任务聚合加载，组合说明/rubric/历史提交、提交及刷新组件；消费后端 participationStatus/completionStatus 并控制只读入口，评分维度复用 UI Rubric，不自行推断完成情况 |
| StudentSubmissionDetailPage | `app/student/submissions/[submissionId]/page.tsx` | 服务端详情/反馈加载、展示兼容、返回上下文及 AI 请求/刷新组件组合；integration 规则见 Frontend API Map |

## 8) Context / State

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| TaskContextHeader | `components/classroomTask/TaskContextHeader.tsx` | Teacher classroomTask 工作区的任务上下文与三件套 tabs；与 Paths 共同收口导航，不承担业务数据 SoT，不强行复用于 Student 或非 classroomTask 页面 |

表单草稿、pending、菜单与展开状态归对应交互组件；跨页筛选/返回上下文归页面与现有 URL helper，不为普通导航建立全局状态副本。

## 9) Shared lib / pure modules

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| Server API Client | `lib/api/client.ts` | Server/RSC 请求入口；调用合同见 Frontend API Map，不在页面拼后端绝对 URL |
| Browser API Client | `lib/api/browser-client.ts` | Client 请求入口与统一错误类型；业务组件复用，不复制 fetch 基础设施 |
| Error Presenter | `lib/api/error-presenter.ts` | 错误 detail 提取及展示整理，不改变后端语义 |
| Teacher Types Adapter | `lib/api/types-teacher.ts` | 教师 payload 解析与容错映射的修改落点；字段适配合同归 Frontend API Map，不在 JSX 深层散写访问 |
| Classroom Task Options | `lib/api/classroom-task-options.ts` | 报表排除选项的共享只读加载模块；分页、去重和 payload 兼容细节见 Frontend API Map，不在各页复制或加入写操作 |
| Student Types Adapter | `lib/api/types-student.ts` | 学生 payload 解析与容错映射的修改落点；不在 JSX 深层散写字段访问 |
| Session/Auth | `lib/auth/session.ts` + `lib/auth/role-home.ts` | 登录态、角色判断与 role-home 的共同入口；不在业务页创建另一套角色跳转规则 |
| Paths | `lib/routes/paths.ts` | 路径构造及模板/班级/任务上下文导航的单一来源；不在业务页硬编码重复路径 |
| UI Status | `lib/ui/status.ts` | AI 状态文案与通用错误摘要的统一入口 |
| Task Course Labels | `lib/learning-tasks/course-labels.ts` | 课程分类候选、未分类口径、显示/归一化工具的前端单一来源；不从局部查询结果倒推候选 |
| Task Template Visibility/Scope | `lib/learning-tasks/template-visibility-scope.ts` | 模板可见性与列表 scope 的值域、文案、normalize；不在页面和表单散落魔法字符串 |
| Task Template List Sorting | `lib/learning-tasks/template-list-sorting.ts` | 当前页模板默认排序单一来源：mine 最近更新优先，shared 已发布优先后按时间，all 我的模板优先；不复制多套 compare |
| UI Rubric | `lib/ui/rubric.ts` | 教师创建/编辑及学生评分标准复用的四维中文映射入口；不在页面各自维护 labelMap |
| UI Format | `lib/ui/format.ts` | query/date/display/safeGet 等共享工具；不重复实现同类 parse |
| Proxy Route | `app/api/proxy/[...path]/route.ts` | 正式 BFF 转发模块的修改落点，详细合同归 Frontend API Map；不绕过 proxy 或向其中加入业务逻辑 |

## 10) Maintenance / 修改边界

- component/module 新增、职责、composition 或 state owner 变化时更新本文；API 调用/字段适配细节更新 Frontend API Map，route 用途和状态更新 Route Map，UX/视觉原则及 testing evidence 回到各自 Owner。
- 权限入口先看 Session/Auth 与角色 layout；前端角色门禁不替代后端授权。API payload 变化先看对应 adapter 与页面映射，不在 JSX 深层临时拼字段。
- 三件套导航优先改 TaskContextHeader 与 Paths；学习轨迹页的摘要、attempts/tag details 扩展组合仍在对应 page，不为普通展示引入复杂组件体系。attempts 总反馈取 feedbackCount，不能混用 AI 摘要 totalItems；数据适配细节回到 API Owner。
- submission detail 的调用链与主体数据源以 Frontend API Map 为准；展示兼容逻辑位于 Teacher/Student detail page 与 types adapter，不能把缺字段兜底升级为主体数据源。
- 模板创建/编辑/rubric 归模板层；实例发布归 PublishClassroomTaskForm，实例设置与状态流分别归 EditClassroomTaskForm 和 ClassroomTaskLifecycleActions。
- 班级基础编辑归 EditClassroomForm，归档/恢复/删除归 ClassroomLifecycleActions；不要再次把生命周期动作混入编辑表单。
- 去重时保留正式产品动作、只读/ownership 边界与共享模块唯一来源；不复制 API inventory、route implementation state、完整业务状态机或测试日志。
