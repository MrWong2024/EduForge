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
| TeacherShell | `components/layout/TeacherShell.tsx` | 教师端顶栏、主导航、登出与账户入口的组合；窄屏按组换行，短入口保持整词、账户摘要允许收缩截断；不要在业务页重复教师导航 |
| StudentShell | `components/layout/StudentShell.tsx` | 学生端顶栏、主导航、登出与账户入口的组合；窄屏按组换行，短入口保持整词、账户摘要允许收缩截断；不要在业务页重复学生导航 |
| Teacher Gate | `app/teacher/layout.tsx` | 统一调用教师 role gate 并承载角色不匹配 UI；不要在每个页面重复 gate |
| Student Gate | `app/student/layout.tsx` | 统一调用学生 role gate 并承载角色不匹配 UI；不要在每个页面重复 gate |

## 3) Shared Blocks

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| PageHeader | `components/blocks/PageHeader.tsx` | 页面标题、描述与 actions 插槽的共享骨架 |
| EmptyState | `components/blocks/EmptyState.tsx` | 空态展示与动作插槽；页面提供业务含义，不各自复制视觉结构 |
| ErrorState | `components/blocks/ErrorState.tsx` | 错误态与默认展示文案；不改变后端错误语义 |
| RefreshButton | `components/blocks/RefreshButton.tsx` | 复用 router.refresh 的显式刷新入口，不持久化草稿、不轮询 |
| Tabs | `components/blocks/Tabs.tsx` | 任务工作区 tab 导航展示；不在三件套页面重复实现 |
| FloatingMoreMenu | `components/blocks/FloatingMoreMenu.tsx` | 生命周期“更多”菜单的共享浮层基础：Portal 定位、视口边界与外部点击/Esc/滚动关闭；业务组件拥有菜单开关与具体动作，不在业务层复制浮层机制 |

## 4) Auth / Account

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| LoginFrame | `app/(auth)/login/page.tsx` | 登录页各状态共享的 EduForge · 智炼品牌与返回首页入口；只承载外壳，不改变页面原有会话探针、角色分流、next 或错误处理 |
| LoginForm | `components/auth/LoginForm.tsx` | 登录表单、提交/错误状态、合法来源回跳与 role-home 跳转及忘记密码入口；不拥有 forgot/reset 接口合同 |
| ForgotPasswordForm | `components/auth/ForgotPasswordForm.tsx` | 邮箱输入、空值校验、固定防枚举提示及发送倒计时状态；不推断邮箱是否存在，倒计时不替代后端安全边界 |
| ResetPasswordForm | `components/auth/ResetPasswordForm.tsx` | 重置链接 token 的消费、新密码与确认输入、前端校验、提交及成功导航；不将 token 持久化 |
| AccountPageContent | `components/account/AccountPageContent.tsx` | 教师/学生账户页共享组合：资料卡、改密表单与调用方提供的返回入口；登录态加载留在页面 |
| AccountProfileCard | `components/account/AccountProfileCard.tsx` | 只读展示当前用户身份资料；不提供资料编辑 |
| ChangePasswordForm | `components/account/ChangePasswordForm.tsx` | 当前/新/确认密码输入、局部校验与提交状态，成功清空输入并展示结果；会话失效由后端处理 |
| AccountNavEntry | `components/account/AccountNavEntry.tsx` | Shell 内当前用户身份摘要与账户入口；目标路径由调用方提供 |

## 4.1) Public Entry

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| PublicHomePage | `app/page.tsx` | 静态首页入口及 metadata，组合 PublicHome；不读取会话、Cookie、headers 或业务/模型数据，访问投影见 Route Map |
| PublicHome | `components/public/PublicHome.tsx` | Server Component 负责仅含品牌与登录入口的首页 header、footer 与 main 外壳，组合 PublicHomeHero；登录 Link 关闭预取，不读取会话或业务数据 |
| PublicHomeHero | `components/public/PublicHomeHero.tsx` | 局部 Client 边界承载平台大标题/介绍、教学特色和案例预览；拥有唯一 activeIndex，默认 OrbitPass，将左侧“查看协作案例”的详情 Link 与受控 PublicCasePreview 绑定同一案例数据，不自动轮播 |
| PublicCasePreview | `components/public/PublicCasePreview.tsx` | 接受 activeIndex/onSelect 的受控案例预览，导出 publicCasePreviews 供 Hero 复用；内部只保留键盘焦点 refs，维护 ARIA tabs 与左右/Home/End 键，展示简短片段/人的审查及对应静态详情链接，无业务或模型请求 |
| CasesLayout | `app/cases/layout.tsx` | 三个详情共用的 Server 容器、返回首页/登录导航与页脚，组合 PublicCaseNav 承载案例切换；登录禁预取，小型文字说明外部开发验证与 EduForge 教学承载边界，不读取会话或业务数据 |
| PublicCaseNav | `components/public/PublicCaseNav.tsx` | 由跨页 Link 组成的局部 Client 分段导航，以 usePathname 与 paths 中的静态案例目标精确匹配当前项，提供当前页视觉与 aria-current 语义；不持有独立选择状态，不读取会话或业务数据，视觉语言遵循 Design Baseline |
| Case Pages | `app/cases/orbitpass/page.tsx`、`app/cases/framepilot/page.tsx`、`app/cases/patchdock/page.tsx` | 明确静态页面各自提供 metadata 并组合对应正文，不设置索引、动态 slug 分派或内容管理层；路由清单由 Route Map 维护 |
| PublicCaseHeader | `components/public/PublicCaseHeader.tsx` | 三个案例详情共享的 Server 标题卡，固定案例类别首行，按调用方内容展示唯一 h1、简介和关键词；不拥有案例正文或交互状态，统一外观由 Design Baseline 维护 |
| PublicCaseStep | `components/public/PublicCaseStep.tsx` | 三个详情共用的纵向步骤容器，维护步骤序号、h2 与正文层级，内容由各案例传入 |
| PublicCaseCodeBlock | `components/public/PublicCaseCodeBlock.tsx` | 三个详情共用的代码、伪代码与文件树展示，保留文字标签、键盘焦点及局部横向滚动，不执行代码 |
| OrbitPassCase | `components/public/OrbitPassCase.tsx` | 独立详情正文的预约规则、初稿缺陷、人的审查、修订方案、验收标准及说明参考/教学反馈；原观察记录改为输入、触发、预期与依据，保留原预约合同，不执行预约或测试 |
| FramePilotCase | `components/public/FramePilotCase.tsx` | 独立详情的字幕裁切/重排/重复片段时间映射、固定输入对应的静态双时间轴与验收标准；不解码视频、生成字幕或实现播放器 |
| PatchDockCase | `components/public/PatchDockCase.tsx` | 独立详情的文件快照补丁预检、文件树/diff 对照、验收标准与教学追问；只说明预检结论，不应用补丁、操作文件或执行命令 |

三个正文组件就近维护材料，复用共享标题、步骤和代码展示组件，各有一个 h1，按任务约束、AI 初稿、人的审查、修订方案、验证场景与验收标准、独立说明与教学反馈组织；原生 details/summary 只用于阅读，长代码/表格局部滚动，无案例 API、模型调用或通用案例引擎。外观与事实呈现原则见 [Design Baseline](./handoff-frontend-design-baseline.md#62-公开入口与演示材料)。

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
| CreateLearningTaskForm | `components/teacher/CreateLearningTaskForm.tsx` | 模板内容、课程分类、可见性、可选任务难度及单一“评阅标准（可选）”多行文字输入，difficulty/rubric 请求构造复用各自纯 helper；难度成功创建后重置；描述默认10行，评阅标准默认8行，两者均可纵向调整；不提供资料引用输入或添加入口；草稿/发布两种创建动作，无归档创建入口；保存失败保留全部输入，不负责课堂实例发布 |
| EditLearningTaskForm | `components/teacher/EditLearningTaskForm.tsx` | 描述10行，单一“评阅标准（可选）”文字输入有非空白内容8行、否则3行；编辑态可纵向调整，只读长文本可滚动。可选难度仅四状态，无动态自定义旧值选项；编辑/安全显示及请求构造复用共享 helper，未知初值不随其他字段保存而隐式回写，成功同步正式响应、失败保留草稿；字段请求语义见 API Map。rubric 保存复用纯 helper，成功后从正式响应同步文字；同 taskId 刷新 props 不覆盖草稿，页面按 taskId 重建表单。引用编辑区可见性固定于本次 taskId 首次成功加载的非空引用，清空保存及刷新不隐藏；引用成功保存独立更新比较基准。仅明确身份与作者匹配且状态可编辑时允许写入；保存与发布/归档共用 pending 边界，保留列表返回上下文，不承担课堂实例设置 |
| TaskAiContextRefs | `components/teacher/TaskAiContextRefs.tsx` | 普通多行引用 JSON 编辑、就近结构错误与格式化；只读时有引用才按包展示全部路径，无 JSON/复制控件或空配置占位；不渲染路径链接/HTML，不读 ZIP，不进入学生或课堂实例页 |
| ai-context-refs | `lib/learning-tasks/ai-context-refs.ts` | 引用基本结构解析、稳定格式化、语义差异与局部作者编辑判断；保持路径及数组顺序，不复制后端 ZIP 安全校验 |
| TeacherLearningTasksPage | `app/teacher/tasks/page.tsx` | 模板列表 SSR 参数解析、数据加载与外层实际分页链接；难度复用共享筛选解析并传给 LearningTaskFilters，保留列表和来源班级上下文，不在页面过滤已分页结果 |
| LearningTaskFilters | `components/teacher/LearningTaskFilters.tsx` | 模板视图/筛选（含难度）的 URL 状态、分页、列表展示与编辑/查看入口；清空及活动筛选判断包含难度，控件由 URL/初始 props 恢复；“评阅标准”列复用纯 helper 显示文字已填写/未填写，“分类”单元格内复用共享难度显示；桌面五列、窄屏纵向条目，无需横向滚动；保留列表返回上下文，筛选后回首屏；复用共享可见性和排序模块，不在当前页伪造完整候选或发起发布/归档 |
| ClassroomTasksPage | `app/teacher/classrooms/[classroomId]/tasks/page.tsx` | 班级任务与发布候选分别 SSR 加载，解析并下传候选难度；已发布列表请求不使用候选难度，其分页链接保留候选条件，具体调用合同见 API Map |
| PublishClassroomTaskForm | `components/teacher/PublishClassroomTaskForm.tsx` | 可见已发布模板的筛选、候选追加加载、选择状态与实例发布；难度及既有筛选变化时清除选择并重置候选，复用请求 epoch 和局部等待状态，过期响应不污染新候选；等待及当前候选成员校验同时作用于控件和提交入口，截止/迟交草稿独立保留，详细状态合同见 API Map。课程分类复用共享候选；发布者来源与已选模板摘要由本组件展示，候选及摘要复用共享难度显示；评阅标准摘要复用纯 helper，候选未提供 rubric 时提示到模板详情核对，不宣称未填写。不提供 AI 策略选择，不创建/编辑模板，不自行判定后端候选全集 |
| TeacherTaskDetailPage | `app/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/page.tsx` | 加载课堂任务正式投影，基础信息展示难度并组合共享 rubric；难度显示复用共享 helper，字段读源见 API Map |
| ClassroomTaskLifecycleActions | `components/teacher/ClassroomTaskLifecycleActions.tsx` | 实例状态展示、关闭/恢复提交及确认/请求状态；恢复只改变运行状态，不自动改截止或迟交设置；RECALLED 无动作，不做物理删除或发布表单 |
| EditClassroomTaskForm | `components/teacher/EditClassroomTaskForm.tsx` | 列表行内展开、草稿输入与实例截止/迟交设置保存；ACTIVE/CLOSED 可编辑，RECALLED 无入口；不修改模板或状态流 |
| PublishTaskStatusButton | `components/teacher/PublishTaskStatusButton.tsx` | 单一模板发布操作；当前 classroomTask 详情页不使用，模板生命周期入口留在模板层 |
| RemoveStudentButton | `components/teacher/RemoveStudentButton.tsx` | 单个成员移除及动作结果，不负责成员列表或成员关系判定 |
| TeacherFeedbackForm | `components/teacher/TeacherFeedbackForm.tsx` | 教师反馈创建输入与提交，复用统一反馈选项；评语草稿绑定实际查看版本，刷新不重绑，冲突/未知结果保留草稿并显式核对当前作品与反馈后确认继续；标签可选，不提供 scoreHint 入口，合同与归一化归 API Owner |
| TeacherFeedbackHistory | `components/teacher/TeacherFeedbackHistory.tsx` | 教师与 AI 反馈历史组合及编辑态切换，同一时间只展开一个编辑表单；仅明确 TEACHER 且有 id 的反馈可修改，AI 只读；未知或缺失来源有记录时才展示“其他反馈（来源未识别）”只读兜底，不作为正式业务来源 |
| TeacherFeedbackEditForm | `components/teacher/TeacherFeedbackEditForm.tsx` | 单条教师反馈原地编辑、请求/错误状态、保存后退出编辑；与创建表单保持输入能力一致，不展示或编辑 scoreHint，不承担历史列表状态 |
| TeacherSubmissionDetailPage | `app/teacher/submissions/[submissionId]/page.tsx` | 权威详情/反馈加载、返回导航及共享作品/AI 展示；可选评阅标准复用 TaskRubric，正式实例读源与失败边界见 API Map；AI 申请仅更新局部结果，不自动整页刷新，不以 AI 状态改变人工反馈表单 key；新增表单和历史编辑态归 feedback 组件 |

## 6) Teacher Analytics / Reports

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| ProcessAssessmentPage | `app/teacher/classrooms/[classroomId]/process-assessment/page.tsx` | URL 条件、服务端加载、分页、摘要、评分说明与 CSV 入口组合；使用 TaskExclusionPanel 的过程性评价模式及共享任务选项 helper；不重算后端评分或持久化排除条件 |
| AiLearningAnalyticsPage | `app/teacher/classrooms/[classroomId]/ai-learning-analytics/page.tsx` | Server 页面负责条件解析、总览/学生并行读取、局部错误、任务选项降级和分页；摘要、教学关注、图表、表格与筛选下沉至对应组件，不从学生分页重算摘要 |
| AiLearningAnalyticsStudentPage | `app/teacher/classrooms/[classroomId]/ai-learning-analytics/students/[studentId]/page.tsx` | Server 页面组合学生摘要、逐任务比较图与全任务明细，展示比较端点/最新版本、安全来源与未比较原因并链接对应提交；恢复返回列表上下文，直接消费后端结果，列表状态不扩大详情请求范围 |
| TaskExclusionPanel | `components/teacher/TaskExclusionPanel.tsx` | 共享临时任务排除 Client Component，支持 process-assessment / ai-learning-analytics 模式；拥有 checkbox 草稿、应用/清空及导航 pending 状态，保留未显示的已选 ID；应用/清空回首屏并保持其他上下文，清空不携带当前 checkbox 选择；不持久化或修改教学数据 |
| AiLearningAnalyticsStudentFilters | `components/teacher/AiLearningAnalyticsStudentFilters.tsx` | Client Component 仅管理姓名/学号、总体结果与反馈参与阶段的受控草稿，按已应用参数重新初始化并在正常清空点击时重置；保留原生 GET 表单与统计范围，应用/清空回首屏并定位学生分析区，筛选与统计仍由服务端完成 |
| AiLearningAnalyticsSummary / AiLearningAnalyticsTeachingAttention | `components/teacher/AiLearningAnalyticsSummary.tsx` | 纯 Server 摘要展示后端 V1.2 计数、请求覆盖/可用反馈交付/更新率与证据提示，明确可比子集；教学关注带样本数，零上升/下降事件不生成相应极值提示，全部已更新不提示更新不足，不生成评分或风险等级 |
| AiLearningAnalyticsTaskTable / AiLearningAnalyticsStudentsTable | `components/teacher/AiLearningAnalyticsTables.tsx` | 任务/学生表及四类结果分布展示，学生表组合总体结果、参与阶段与保留列表状态的详情入口；不做前端排序、过滤或排名 |
| AiLearningAnalyticsCharts | `components/teacher/AiLearningAnalyticsCharts.tsx` | 班级/个人复用原生 SVG 逐任务 before/after 坐标及四类分布；班级轴为平均反馈条目负荷，个人轴为反馈条目负荷；负责可访问表达，不连接不同任务、不把 null 绘为0、不重算后端分母 |
| AiLearningAnalyticsMethodologyPanel / AiLearningAnalyticsMetricGuide | `components/teacher/AiLearningAnalyticsMethodology.tsx` | V1.2 方法与共享解释：负荷下降、前后均无 ERROR/WARN、非零负荷持平、负荷上升；区分更新与新增提交、来源及证据局限、可比子集和净变化抵消，不推断阅读/理解/采纳或能力；不承担业务计算 |

## 7) Student 交互组件

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| JoinClassroomForm | `components/student/JoinClassroomForm.tsx` | 加入码输入与入班动作，不判断后端入班权限 |
| SubmissionForm | `components/student/SubmissionForm.tsx` | 原文源码与独立可选说明输入、码点校验、请求防重复及公开业务错误安全适配；成功保存后锁住当前表单，导航恢复只打开同一提交详情，结果未确认先核对历史；多文件粘贴格式提示与示例由此维护，单文件无需 FILE 标记；不提供上传/结构化文件提交，不以模板当前状态自行阻断 |
| EditSubmissionForm | `components/student/EditSubmissionForm.tsx` | 同次提交的受控代码/语言/说明草稿及 baseRevision；取消无写，保存采用权威详情，刷新不覆盖草稿/静默换版；冲突或未知结果锁住保存，显式读取作品并确认后继续，取消不绕过核对门禁，评阅已受理时保留可复制草稿；学生作品展示与共享 AI 区块使用同一当前详情 |
| RequestAiFeedbackButton | `components/student/RequestAiFeedbackButton.tsx` | 师生复用的申请按钮展示；disabled/pending 与动作回调由 SubmissionAiReview 提供，不独立持有资格或请求时序 |
| AiProcessingHint | `components/student/AiProcessingHint.tsx` | 统一 AI 处理中提示；通用状态文案复用 UI Status |
| SubmissionAutoRefresh | `components/student/SubmissionAutoRefresh.tsx` | 仅学生提交详情：以共享区块已接纳状态在 PENDING/RUNNING 或 FAILED 且计划重试时调用局部读取；操作中和待显式确认时暂停；终态及信息不足停止；沿用退避、失焦暂停和定时器清理，不用于草稿页 |
| StudentTaskDetailPage | `app/student/classrooms/[classroomId]/tasks/[classroomTaskId]/page.tsx` | 实例教学内容与历史提交加载，基础信息复用共享难度显示，字段读源见 API Map；明确快照/后端参与资格控制提交，消费 completionStatus；组合共享 rubric 和提交表单，仅显式刷新，提示师生在提交详情主动申请 AI |
| StudentSubmissionDetailPage | `app/student/submissions/[submissionId]/page.tsx` | 权威详情/反馈加载、返回导航及共享作品/AI 展示，限定状态自动刷新；query 不补业务事实 |

共享文本教学展示：

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| TaskRubric | `components/learning-tasks/TaskRubric.tsx` | 师生只读“评阅标准”，仅展示字符串 rubric.notes，保留换行、断行与未填写提示；读取复用纯 helper，不推断成绩 |
| SubmissionContent | `components/submissions/SubmissionContent.tsx` | 师生作品原文展示；源码局部滚动、说明/声明纯文本换行，展示快照状态；白色作品面板保持明确前景色 |
| SubmissionAiReview | `components/submissions/SubmissionAiReview.tsx` | 师生共享安全 AI 摘要；拥有当前提交的串行 POST/GET、操作标识及统一接纳结果；申请绑定页面实际展示作品版本，轮询不自动升级；成功 Job 持续关闭申请，不确定结果仅由事后显式完整读取重新核对；按提交 ID 隔离并卸载取消。学生组合受限轮询，教师仅显式整页刷新，不管理人工反馈草稿 |

## 8) Context / State

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| ClassroomTask Layout | `app/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/layout.tsx` | 为工作区加载可选展示名称并传给 TaskContextHeader；辅助读取独立降级，不替代子页面主体数据或错误处理 |
| TaskContextHeader | `components/classroomTask/TaskContextHeader.tsx` | 展示 layout 提供的班级／课堂任务名称及缺失占位，承载三件套 tabs；与 Paths 共同收口导航，不承担业务数据 SoT，不强行复用于 Student 或非 classroomTask 页面 |

表单草稿、pending、菜单与展开状态归对应交互组件；跨页筛选/返回上下文归页面与现有 URL helper，不为普通导航建立全局状态副本。

## 9) Shared lib / pure modules

| Component / Module | File | Responsibility / Boundary |
|---|---|---|
| Server API Client | `lib/api/client.ts` | Server/RSC 请求入口；调用合同见 Frontend API Map，不在页面拼后端绝对 URL |
| Browser API Client | `lib/api/browser-client.ts` | Client 请求入口与统一错误类型；业务组件复用，不复制 fetch 基础设施 |
| Error Presenter | `lib/api/error-presenter.ts` | 原始错误提取保留给内部原因识别；最终说明仅展示调用方已生成的业务 summary，不附原始 detail/code，不改变后端语义 |
| Teacher Types Adapter | `lib/api/types-teacher.ts` | 教师 payload 解析与容错映射的修改落点；字段适配合同归 Frontend API Map，不在 JSX 深层散写访问 |
| Classroom Task Options | `lib/api/classroom-task-options.ts` | 报表排除选项的共享只读加载模块；分页、去重和 payload 兼容细节见 Frontend API Map，不在各页复制或加入写操作 |
| Student Types Adapter | `lib/api/types-student.ts` | 学生 payload 解析与容错映射的修改落点；不在 JSX 深层散写字段访问 |
| Session/Auth | `lib/auth/session.ts` + `lib/auth/role-home.ts` | 登录态、角色判断与 role-home 的共同入口；不在业务页创建另一套角色跳转规则 |
| Paths | `lib/routes/paths.ts` | 路径构造及模板/班级/任务上下文导航的单一来源；不在业务页硬编码重复路径 |
| Text submission helpers | `lib/learning-tasks/text-submission.ts` | 原文请求构造、码点校验、保存后 POST 门禁与同一详情恢复路径、已知公开提交错误安全适配；产品实际调用 |
| Submission AI operations | `lib/learning-tasks/submission-ai-operations.ts` | 单个挂载提交内的操作标识、串行读写、确认资格与已接纳摘要；无网络、无全局锁，不定义后端 Job 状态转换 |
| AI Review | `lib/learning-tasks/ai-review.ts` | 快照展示、严格摘要适配及学生轮询资格的纯逻辑，不推断后端授权 |
| UI Status | `lib/ui/status.ts` | 按领域显示模板、课程、班级、课堂任务、成员关系和账号状态，统一 AI 状态、失败原因及通用错误摘要；仅转换显示标签，不参与状态或资格判断 |
| Feedback Options | `lib/ui/feedback-options.ts` | 已知反馈类型、严重程度按“英文 value - 中文”双语显示，来源仍用中文；保留现有选项值、顺序及表单归一化，不把未知值伪装成已知分类 |
| Feedback Tags | `lib/ui/feedback-tags.ts` | 预设反馈标签的 label 按“英文 value - 中文”双语显示，helper 直接返回 label，不重复拼接前缀；未知非空标签仍保留原文，value、顺序及业务文本不变 |
| Task Course Labels | `lib/learning-tasks/course-labels.ts` | 课程分类候选、未分类口径、显示/归一化工具的前端单一来源；不从局部查询结果倒推候选 |
| Task Template Visibility/Scope | `lib/learning-tasks/template-visibility-scope.ts` | 模板可见性与列表 scope 的值域、文案、normalize；不在页面和表单散落魔法字符串 |
| Task Template List Sorting | `lib/learning-tasks/template-list-sorting.ts` | 当前页模板默认排序单一来源：mine 最近更新优先，shared 已发布优先后按时间，all 我的模板优先；不复制多套 compare |
| Task Rubric | `lib/learning-tasks/rubric.ts` | 字符串 notes 读取、首尾 trim 与创建/编辑请求构造：创建空白省略 rubric，编辑空白发送 {}；不合并旧对象。共享只读/列表按文字判断填写状态，候选缺字段单独提示核对 |
| Task Difficulty | `lib/learning-tasks/difficulty.ts` | 难度四状态的输入、安全显示和创建/编辑请求构造，以及独立的严格查询解析；未知输入只显示未设置，不生成自定义写入或隐式清理原值。由模板表单、模板选择/筛选 SSR 与组件及师生课堂详情复用，具体口径见 Frontend API Map |
| Submission Language | `lib/learning-tasks/submission-language.ts` | 提交语言选项目录与师生只读 label 映射，不转换请求值 |
| UI Format | `lib/ui/format.ts` | query/date/display/safeGet 及共享首次提交迟交时长展示工具；不重复实现同类 parse |
| Proxy Route | `app/api/proxy/[...path]/route.ts` | 正式 BFF 转发模块的修改落点，详细合同归 Frontend API Map；不绕过 proxy 或向其中加入业务逻辑 |

## 10) Maintenance / 修改边界

- component/module 新增、职责、composition 或 state owner 变化时更新本文；API 调用/字段适配细节更新 Frontend API Map，route 用途和状态更新 Route Map，UX/视觉原则及 testing evidence 回到各自 Owner。
- 权限入口先看 Session/Auth 与角色 layout；前端角色门禁不替代后端授权。API payload 变化先看对应 adapter 与页面映射，不在 JSX 深层临时拼字段。
- 三件套导航优先改 TaskContextHeader 与 Paths；学习轨迹页的摘要、attempts/tag details 扩展组合仍在对应 page，不为普通展示引入复杂组件体系。attempts 总反馈取 feedbackCount，不能混用 AI 摘要 totalItems；数据适配细节回到 API Owner。
- submission detail 的调用链与主体数据源以 Frontend API Map 为准；师生正文和 AI 事实只来自详情 mapper；query 不提供正文或业务状态；教师可选评阅标准的上下文定位与权威读源见 API Owner。
- 模板创建/编辑/rubric 归模板层；实例发布归 PublishClassroomTaskForm，实例设置与状态流分别归 EditClassroomTaskForm 和 ClassroomTaskLifecycleActions。
- 班级基础编辑归 EditClassroomForm，归档/恢复/删除归 ClassroomLifecycleActions；不要再次把生命周期动作混入编辑表单。
- 去重时保留正式产品动作、只读/ownership 边界与共享模块唯一来源；不复制 API inventory、route implementation state、完整业务状态机或测试日志。
