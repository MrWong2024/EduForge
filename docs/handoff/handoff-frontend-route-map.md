# 前端路由地图（Route Map）

## Scope / Owner

- 本文维护当前 `frontend/app/**` 实际存在的 route inventory：角色与访问投影、页面用途、主要数据/领域依赖、核心用户交互、route-specific 高层边界及 implementation state。当前源码是最高事实源。
- `/teacher/**` 与 `/student/**` 由对应 layout 执行 server-side role gate：仅在既有 gate 明确确认 401 后，将未登录访问重定向到干净的 `/`（不附带 query、hash 或 `next`）；角色不匹配仍展示 403 UI，其他错误沿用原处理；前端入口约束不替代后端权限。
- 正式业务请求统一走 `/api/proxy/**`。API helper、BFF、backend endpoint、request/response adaptation 与 integration boundary 由 [Frontend API Map](./handoff-frontend-api-map.md) 维护；下表只列高层数据依赖，不维护第二套接口清单。
- 组件职责、local state 与 composition 见 [Component Map](./handoff-frontend-component-map.md)，稳定 UX/视觉/交互原则见 [Design Baseline](./handoff-frontend-design-baseline.md)，Browser/smoke/evidence 见 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。本文不复制 DTO 字段、HTTP error matrix、普通分页参数、mapper、selector/Portal 或完整布局。
- 完成度是 route implementation state：`Done` = 当前主视图、主要交互和真链路已存在；`Partial` = 页面存在但能力不完整。Done 不等于最终交付定版，也不替代 [Roadmap](./handoff-roadmap.md) 的 CURRENT/ACTIVE/PLANNED/DEFERRED。

## 1) Auth 与入口

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/` | EduForge · 智炼公开首页与案例选择入口 | 平台介绍与局部单案例预览，无会话或业务数据依赖 | 所有访问者查看相同平台内容；手动切换 OrbitPass、FramePilot、PatchDock，默认 OrbitPass，左侧“查看协作案例”与右侧预览均进入当前选中案例的独立详情；顶部仅保留品牌与登录入口，登录链接关闭预取 | Done |
| `/cases/orbitpass` | OrbitPass｜大会席位预约 | 静态工程案例与共享 CasesLayout | 独立 metadata、唯一正文 h1，阅读预约并发与重试的审查、修订及验收标准；自然滚动，返回首页/切换案例/登录由共享布局提供 | Done |
| `/cases/framepilot` | FramePilot｜智能视频剪辑工作台 | 静态工程案例与共享 CasesLayout | 独立 metadata、唯一正文 h1，阅读字幕时间映射与静态时间轴；不处理真实视频，导航与访问边界同共享布局 | Done |
| `/cases/patchdock` | PatchDock｜AI 代码补丁审查台 | 静态工程案例与共享 CasesLayout | 独立 metadata、唯一正文 h1，阅读文件快照补丁预检与差异；不实际应用补丁，导航与访问边界同共享布局 | Done |
| `/login` | 登录与角色分流 | Auth / 当前用户 | 主动登录；合法单斜杠站内 `next` 优先，非法值回退既有角色首页，无可用角色仍提示。请求中锁定表单，成功建立会话后独立确认并导航；确认失败提供刷新核对或返回登录，页面错误只展示安全摘要。共享品牌外壳和返回首页入口保持 | Done |
| `/forgot-password` | 忘记密码 | Auth 密码重置请求 | 输入邮箱提交申请，请求期间锁定；成功保留邮箱和 60 秒冷却，只提示请求已提交及邮箱存在时将发送邮件，不承诺送达；可返回登录 | Done |
| `/reset-password` | 重置密码 | Auth 密码重置 | 使用链接设置并确认新密码，请求期间锁定，成功清空密码并保持完成态；缺少 token 提供申请入口，明确失效链接可重新申请；普通输入错误与结果不确定各自提供安全提示与恢复入口，token 处理归 API/Component Owner | Done |

注销请求成功后同样前往干净的 `/`；失败沿用原错误处理。

案例由三个明确的静态 page 提供，无 `/cases` 索引或动态 slug 分派；未知案例地址返回 404。案例页与首页均不读取会话、cookies、headers 或业务/模型数据；公开页面登录入口禁用预取。组件职责与内容边界见 [Component Map](./handoff-frontend-component-map.md#41-public-entry)。

## 2) Teacher 路由

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/teacher` | 教师入口 | 无数据依赖 | 重定向到班级列表 | Done |
| `/teacher/account` | 账户设置 | 当前用户 / 改密能力 | 查看本人资料、修改密码；无资料编辑 UI；可返回班级列表 | Done |
| `/teacher/courses` | 课程列表与创建 | Course 列表 / 生命周期 | 按进行中、已归档、全部查看并分页；创建含课程分类，进入编辑/总览；列表“更多”提供 ACTIVE 归档/删除、ARCHIVED 恢复/删除，删除需确认且仅空课程允许。读取到可信总数且页码越界时回到最后有效页，保留 `statusView` 和 `limit` | Done |
| `/teacher/courses/[courseId]/overview` | 课程总览 | [Course overview API](./handoff-backend-dto-cheatsheet.md#课程总览) | 切换统计窗口、班级排序与分页并进入班级；主窗口 all/7d、默认 all，旧链接窗口继续兼容。支持第 101 页等合法高页码，每页最多 100 个班级。可信班级总数确认越界时回到最后有效页，保留窗口、排序、方向和每页条数。班级总数取总量，班级数、平均任务完成度与平均 AI 成功率摘要基于当前页；任务完成度与学生触达率分别展示，无 AI 活动时成功率显示缺省；页面只读 | Done |
| `/teacher/courses/[courseId]/edit` | 课程基础信息编辑 | Course 详情 / 更新 | 从列表或总览进入，编辑编号、名称、学期、课程分类，保存后回总览；总览保持展示职责 | Done |
| `/teacher/tasks` | 任务模板列表与创建 | [Task template 查询 / 创建](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family) | 默认我的模板，可切换我的/共享/全部并按课程分类、状态、知识模块、难度筛选及分页。可信模板总数确认越界时回到最后有效页，保留筛选和班级来源。创建为草稿或发布模板，展示可见性、发布者和评阅标准填写状态。作者的 DRAFT/PUBLISHED 可编辑，ARCHIVED 及非作者模板仅查看。保留列表回跳上下文 | Done |
| `/teacher/tasks/[taskId]/edit` | 模板编辑或只读查看 | Task template 详情 / 生命周期 | 作者编辑 DRAFT/PUBLISHED 的内容、可见性与文字评阅标准；保存内容与生命周期动作分离；DRAFT 可发布、PUBLISHED 可归档，均需确认。ARCHIVED、非作者共享模板及未知状态只读；无恢复入口，归档复用提示不代表已有复制功能；returnTo 仅接受规范化后路径严格为 `/teacher/tasks` 的站内地址，保留有效列表上下文；非法或缺失时回退模板列表 | Done |
| `/teacher/classrooms` | 班级列表与创建 | Classroom 列表 / Course 关联 | 按课程及进行中、已归档、全部筛选并分页；创建、进入编辑/看板。`courseId` 同时指定列表筛选和建班表单初始课程，表单改选只影响创建。目标课程无法确认时保留可读列表，建班区提示并提供返回普通班级页的入口。班级行优先显示行内课程名称，缺失时用已加载课程名称。列表“更多”提供 ACTIVE 归档/删除、ARCHIVED 恢复/删除，删除需确认且仅空班级允许；非空限制由后端判定。读取到可信总数且页码越界时回到最后有效页，保留 `courseId`、`statusView` 和 `limit` | Done |
| `/teacher/classrooms/[classroomId]/edit` | 班级基础信息编辑 | Classroom 详情 / 更新 | 当前只编辑班级名称，所属课程、状态及加入码只读；保存后回看板，不影响成员、课堂任务和历史提交；不提供归档/恢复/删除，生命周期动作在列表“更多”菜单 | Done |
| `/teacher/classrooms/[classroomId]` | 班级入口 | 无数据依赖 | 重定向到本班 dashboard | Done |
| `/teacher/classrooms/[classroomId]/dashboard` | 班级看板 | Classroom dashboard API | 默认展示 ACTIVE 任务，可显式包含 CLOSED；展示模板归档提示和非本人模板发布者，进入任务与分析页。空结果说明当前筛选暂无可展示任务，归档班级提供「查看任务列表」。统计及归档建议直接消费后端结果，不二次过滤重算或自动归档 | Done |
| `/teacher/classrooms/[classroomId]/tasks` | 课堂任务列表与发布 | ClassroomTask / 发布候选池 | 进行中班级按课程分类、仅我的、知识模块或难度检索已发布模板，支持加载更多并按截止、迟交设置发布。归档班级保留任务分页、历史和按实例状态可用的管理入口，页面提示当前无法发布或新提交；提交窗口显示不可提交，仍展示实例状态及原设置。关闭、恢复提交或重新开放任务、撤回、删除均须确认。撤回后保留历史入口，空实例删除资格由后端判定 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]` | 课堂任务详情 | ClassroomTask 详情 | 只读展示发布快照状态、教学说明及评阅标准，提示师生在提交详情主动申请 AI，进入三件套或提交管理；实例状态动作在任务列表，模板生命周期在模板层 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` | 课堂任务提交管理 | [ClassroomTask submissions](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源) | 按课堂任务实例查看与分页，进入提交批阅。可信提交记录总数确认越界时回到同一课堂任务的最后有效页。保留班级看板、任务列表/详情及三件套导航上下文 | Done |
| `/teacher/submissions/[submissionId]` | 教师提交详情与批阅 | 正式 submission detail / feedback（[调用链](./handoff-frontend-api-map.md)） | 查看完整源码、独立说明、已有声明、实例评阅标准及安全 AI 摘要，按后端资格申请辅助反馈；AI 申请局部显示结果，仅显式刷新，保护人工反馈草稿；查看首次提交与最近修改时间；新增评语绑定查看的作品版本，冲突保留草稿，重新查看并明确确认后继续；有标识且明确为 TEACHER 的反馈可原地编辑，AI 与未知来源反馈只读，不展示或编辑 scoreHint。按可用上下文返回班级看板、任务提交列表或详情；导航上下文不作为主体数据 SoT | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` | 学习轨迹 | [Learning trajectory API](./handoff-backend-dto-cheatsheet.md#learning-trajectory) | 切换窗口、本页排序及分页，查看最近与首次 AI 错误数变化、展开提交尝试和标签明细。「最近一次 AI 错误数」排序始终将未知值放在末尾，「未提交优先」隐藏升降序控件。可信学生总数确认越界时回到最后有效页，保留窗口、排序、方向、每页条数和明细开关。尝试详情仅在有 AI 反馈条目时显示 AI 错误数；主窗口 all/7d、默认 all，旧链接窗口继续兼容；保留班级看板、任务列表及提交管理导航 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` | 课堂复盘 | Review pack API | 查看问题聚合、典型样例与学生分层，调整窗口及样例范围，样例可进入对应提交；主窗口 all/7d、默认 all，旧链接窗口继续兼容；保留课堂任务上下文导航。按服务端 `studentTiers` 渲染分组，错误数取所选窗口内最新提交的 AI 错误级反馈条数，详见 [Review pack DTO](./handoff-backend-dto-cheatsheet.md#review-pack)。 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` | AI 指标 | AI metrics API | 切换 1h/24h/7d 窗口及标签扩展，查看任务 AI 情况；保留班级看板、任务列表及提交管理导航 | Done |
| `/teacher/classrooms/[classroomId]/members` | 班级成员管理 | Classroom 成员读源 | 查看、分页和移除成员，可包含已移除成员；成员关系以正式读源为准，不回退 legacy studentIds。读取到可信总数且页码越界时回到本班最后有效页，保留 `includeRemoved`，每页 100 名 | Done |
| `/teacher/classrooms/[classroomId]/weekly-report` | 班级周报 | Weekly report API | 汇总型分析页，查看摘要、风险与问题概览；主窗口 7d/30d/all、默认 all，旧链接窗口继续兼容；不宣称已有独立周报明细能力 | Done |
| `/teacher/classrooms/[classroomId]/process-assessment` | 过程性评价 | [Process assessment JSON/CSV](./handoff-backend-dto-cheatsheet.md#process-assessment) / 课堂任务选项 | 主窗口 7d/30d/all，旧链接仅兼容 term；查看分页评价、摘要与评分说明，临时排除/清空任务并导出同口径 CSV。可信学生总数确认越界时回到最后有效页，保留窗口和排除条件。排除不持久化，不重算后端评分；任务选项失败只警告，不阻断评价主体，未显示的已选任务继续保留 | Done |
| `/teacher/classrooms/[classroomId]/ai-learning-analytics` | AI 反馈介入成效分析 | Analytics 总览 / ACTIVE 学生列表 / 任务选项 | 切换窗口、临时排除任务，查看班级/任务/学生 V1.2 分析、可比子集与来源证据提示；区分作品更新和新增提交。姓名/学号搜索、总体结果和参与阶段筛选仅作用于学生列表。分页、详情进入和返回保留筛选上下文，学生筛选/分页后定位学生分析区；区分无 ACTIVE 学生、筛选无结果和空分页。任务选项或学生列表失败局部降级，总览失败为页面错误；直接展示后端结果，不从学生分页重算摘要，不将总体结果当时间趋势或能力/因果结论 | Done |
| `/teacher/classrooms/[classroomId]/ai-learning-analytics/students/[studentId]` | 单学生 AI 反馈介入分析 | Analytics student detail API | 展示后端总体结果、参与阶段、逐任务反馈条目负荷、实际比较版本与对应提交链接、来源和较新未比较提示；不连接不同任务，不把不可比较或未知值画为0。列表筛选与页码仅用于返回并恢复学生分析区上下文，不改变详情数据范围 | Done |
| `/teacher/classrooms/[classroomId]/export/snapshot` | 教学快照预检（内部） | [Snapshot export API](./handoff-backend-dto-cheatsheet.md#classroom-export-snapshot) | 回显实际查询窗口、两个数量上限与每任务明细开关，显示进度、AI 运行、常见问题和迟交摘要；保留服务端提示及原始数据折叠入口 | Done |

## 3) Student 路由

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/student` | 学生入口 | 无数据依赖 | 重定向到学习看板 | Done |
| `/student/account` | 账户设置 | 当前用户 / 改密能力 | 查看本人资料、修改密码；无资料编辑 UI；可返回学习看板 | Done |
| `/student/dashboard` | 学习看板 | [Student classroom dashboard API](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family) | 查看班级与任务、进入任务详情；默认当前和近期过期任务，可显式查看历史并保留分页视图。按有可见任务的班级分页，可信总数确认越界时回到最后有效页并保留历史筛选。卡片内完整展示后端可见任务；展示教师、课程、学期摘要，不暴露无关标识或联系方式。完成情况直接消费 completionStatus，模板当前状态不作为二次过滤或参与阻断依据 | Done |
| `/student/classrooms/join` | 加入班级 | Classroom join 能力 | 输入加入码入班，资格由后端判定 | Done |
| `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` | 学生任务详情与提交 | my-task-detail 聚合 / submission | 查看任务说明、评阅标准、完成情况、历史提交与 AI 状态。提交历史按次显示 AI 反馈预览，可切换显示和每次条数上限。每次提交均可通过「查看反馈」进入完整详情。completionStatus 由后端提供，不从反馈或 AI 状态推断。提交要求明确快照可用且 participationStatus.canSubmit=true，缺字段关闭写入口，保留只读原因；独立说明按码点校验并原样保存；草稿页仅显式刷新；不以模板当前状态阻断。已截止且不允许迟交时禁用提交，允许迟交且有参与资格时可提交；成功保存后锁住表单并进入 submission detail，导航未完成时可再次打开同一已保存详情 | Done |
| `/student/submissions/[submissionId]` | 学生提交详情与反馈 | 正式 submission detail / feedback（[调用链](./handoff-frontend-api-map.md)） | 查看完整源码、独立说明、已有声明、首次提交与最近修改的迟交事实及 AI 摘要；符合资格时修改本次提交，取消不写，冲突保留草稿并显式核对；仅按后端资格请求 AI，进入评阅后作品不可修改；可返回来源任务，导航上下文不作为主体数据 SoT；状态刷新职责见 Component Map | Done |
| `/student/help/ai` | AI 状态帮助 | 静态帮助内容 | 说明学生或教师可在提交详情主动申请 AI，解释有限重试、作品保存与 AI 失败的区别、模拟/覆盖/未知用量及教师判断边界 | Done |

## 4) 辅助路由（非主交付链）

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 当前实现 |
|---|---|---|---|---|
| `/api/proxy/[...path]` | 正式 BFF 代理入口 | Backend API；实现见 [Frontend API Map](./handoff-frontend-api-map.md) | 正式业务主链路必经，业务页面不绕过代理 | 已接入 |

当前没有正式 `/ops/**` 前端页面；debug/ops 的后端接口与启用边界由 API Owner 维护。

## 5) Maintenance

- route 新增/删除、角色、页面用途、主要用户交互或 implementation state 变化时更新本文；以源码确认 Done/Partial，不复制 Roadmap 阶段状态。
- API helper、BFF、backend endpoint 或数据适配变化更新 Frontend API Map；本文仅同步受影响的高层依赖与页面语义。
- component responsibility、composition/state owner 变化更新 Component Map；稳定 UX/视觉原则更新 Design Baseline；testing evidence 更新 Testing Playbook。
- 跨层事实采用最低充分引用；submission detail 的主体读源、纯导航 query 与调用链统一回到 Frontend API Map，不在本文恢复独立数据源合同。
