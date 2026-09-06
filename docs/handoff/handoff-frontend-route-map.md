# 前端路由地图（Route Map）

## Scope / Owner

- 本文维护当前 `frontend/app/**` 实际存在的 route inventory：角色与访问投影、页面用途、主要数据/领域依赖、核心用户交互、route-specific 高层边界及 implementation state。当前源码是最高事实源。
- `/teacher/**` 与 `/student/**` 由对应 layout 执行 server-side role gate：未登录重定向到 `/login`，角色不匹配展示 403 UI；前端入口约束不替代后端权限。
- 正式业务请求统一走 `/api/proxy/**`。API helper、BFF、backend endpoint、request/response adaptation 与 integration boundary 由 [Frontend API Map](./handoff-frontend-api-map.md) 维护；下表只列高层数据依赖，不维护第二套接口清单。
- 组件职责、local state 与 composition 见 [Component Map](./handoff-frontend-component-map.md)，稳定 UX/视觉/交互原则见 [Design Baseline](./handoff-frontend-design-baseline.md)，Browser/smoke/evidence 见 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。本文不复制 DTO 字段、HTTP error matrix、普通分页参数、mapper、selector/Portal 或完整布局。
- 完成度是 route implementation state：`Done` = 当前主视图、主要交互和真链路已存在；`Partial` = 页面存在但能力不完整。Done 不等于最终交付定版，也不替代 [Roadmap](./handoff-roadmap.md) 的 CURRENT/ACTIVE/PLANNED/DEFERRED。

## 1) Auth 与入口

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/` | 根入口 | 无数据依赖 | 重定向到登录页 | Done |
| `/login` | 登录与角色分流 | Auth / 当前用户 | 登录、保留合法来源回跳、按角色进入工作区；无角色时提示 | Done |
| `/forgot-password` | 忘记密码 | Auth 密码重置请求 | 输入邮箱请求重置邮件；固定防枚举成功提示；可返回登录 | Done |
| `/reset-password` | 重置密码 | Auth 密码重置 | 使用重置链接设置并确认新密码，成功后返回登录；token 处理归 API/Component Owner | Done |

## 2) Teacher 路由

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/teacher` | 教师入口 | 无数据依赖 | 重定向到班级列表 | Done |
| `/teacher/account` | 账户设置 | 当前用户 / 改密能力 | 查看本人资料、修改密码；无资料编辑 UI；可返回班级列表 | Done |
| `/teacher/courses` | 课程列表与创建 | Course 列表 / 生命周期 | 按进行中、已归档、全部查看并分页；创建含课程分类，进入编辑/总览；列表“更多”提供 ACTIVE 归档/删除、ARCHIVED 恢复/删除，删除需确认且仅空课程允许；操作保留当前视图 | Done |
| `/teacher/courses/[courseId]/overview` | 课程总览 | Course overview API | 切换统计窗口、班级排序与分页并进入班级；主窗口 all/7d、默认 all，旧链接窗口继续兼容。班级总数取总量，班级数、平均任务完成度与平均 AI 成功率摘要基于当前页；任务完成度与学生触达率分别展示，无 AI 活动时成功率显示缺省；页面只读 | Done |
| `/teacher/courses/[courseId]/edit` | 课程基础信息编辑 | Course 详情 / 更新 | 从列表或总览进入，编辑编号、名称、学期、课程分类，保存后回总览；总览保持展示职责 | Done |
| `/teacher/tasks` | 任务模板列表与创建 | Task template 查询 / 创建 | 默认我的模板，可切换我的/共享/全部并按课程分类、状态、知识模块、阶段筛选及分页；创建为草稿或发布模板；展示可见性和发布者。作者的 DRAFT/PUBLISHED 可编辑，ARCHIVED 及非作者模板仅查看；保留班级来源和列表回跳上下文 | Done |
| `/teacher/tasks/[taskId]/edit` | 模板编辑或只读查看 | Task template 详情 / 生命周期 | 作者编辑 DRAFT/PUBLISHED 的内容、可见性与 rubric；保存内容与生命周期动作分离；DRAFT 可发布、PUBLISHED 可归档，均需确认。ARCHIVED、非作者共享模板及未知状态只读；无恢复入口，归档复用提示不代表已有复制功能；返回原模板列表上下文，非法或缺失时回模板列表 | Done |
| `/teacher/classrooms` | 班级列表与创建 | Classroom 列表 / Course 关联 | 按课程及进行中、已归档、全部筛选并分页；创建、进入编辑/看板。列表“更多”提供 ACTIVE 归档/删除、ARCHIVED 恢复/删除，删除需确认且仅空班级允许；非空限制由后端判定，操作保留当前视图 | Done |
| `/teacher/classrooms/[classroomId]/edit` | 班级基础信息编辑 | Classroom 详情 / 更新 | 当前只编辑班级名称，所属课程、状态及加入码只读；保存后回看板，不影响成员、课堂任务和历史提交；不提供归档/恢复/删除，生命周期动作在列表“更多”菜单 | Done |
| `/teacher/classrooms/[classroomId]` | 班级入口 | 无数据依赖 | 重定向到本班 dashboard | Done |
| `/teacher/classrooms/[classroomId]/dashboard` | 班级看板 | Classroom dashboard API | 默认展示 ACTIVE 任务，可显式包含 CLOSED；展示模板归档提示和非本人模板发布者，进入任务与分析页。统计及归档建议直接消费后端结果，不二次过滤重算或自动归档 | Done |
| `/teacher/classrooms/[classroomId]/tasks` | 课堂任务列表与发布 | ClassroomTask / 发布候选池 | 按课程分类、仅我的、知识模块及阶段检索可见已发布模板，候选支持加载更多，已发布任务支持分页；候选排除本班已发布模板，课程优先排序，展示发布者与模板归档提示。配置截止、迟交和次数限制后发布实例；ACTIVE 可关闭、CLOSED 可恢复提交，两者可编辑实例设置，RECALLED 仅展示。生命周期、截止与提交窗口分别表达，前端提示不替代后端权限；可进入详情/提交/三件套及模板页，不在此维护模板 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]` | 课堂任务详情 | ClassroomTask 详情 | 只读展示实例信息和任务说明，进入三件套或提交管理；实例状态动作在任务列表，模板生命周期在模板层 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` | 课堂任务提交管理 | ClassroomTask submissions | 按课堂任务实例查看与分页，进入提交批阅；保留班级看板、任务列表/详情及三件套导航上下文 | Done |
| `/teacher/submissions/[submissionId]` | 教师提交详情与批阅 | 正式 submission detail / feedback（[调用链](./handoff-frontend-api-map.md)） | 查看代码和反馈、新增教师反馈；有标识的教师反馈可原地编辑，AI/SYSTEM 反馈只读，不展示或编辑 scoreHint。按可用上下文返回班级看板、任务提交列表或详情；导航上下文不作为主体数据 SoT | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` | 学习轨迹 | Learning trajectory API | 切换窗口、排序及分页，查看最近与首次错误数变化、展开提交尝试和标签明细；主窗口 all/7d、默认 all，旧链接窗口继续兼容；保留班级看板、任务列表及提交管理导航 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` | 课堂复盘 | Review pack API | 查看问题聚合、典型样例与学生分层，调整窗口及样例范围，样例可进入对应提交；主窗口 all/7d、默认 all，旧链接窗口继续兼容；保留课堂任务上下文导航 | Done |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` | AI 指标 | AI metrics API | 切换 1h/24h/7d 窗口及标签扩展，查看任务 AI 情况；保留班级看板、任务列表及提交管理导航 | Done |
| `/teacher/classrooms/[classroomId]/members` | 班级成员管理 | Classroom 成员读源 | 查看、分页和移除成员，可包含已移除成员；成员关系以正式读源为准，不回退 legacy studentIds | Done |
| `/teacher/classrooms/[classroomId]/weekly-report` | 班级周报 | Weekly report API | 汇总型分析页，查看摘要、风险与问题概览；主窗口 7d/30d/all、默认 all，旧链接窗口继续兼容；不宣称已有独立周报明细能力 | Done |
| `/teacher/classrooms/[classroomId]/process-assessment` | 过程性评价 | Process assessment JSON/CSV / 课堂任务选项 | 主窗口 7d/30d/all，旧链接仅兼容 term；查看分页评价、摘要与评分说明，临时排除/清空任务并导出同口径 CSV。排除不持久化，不重算后端评分；任务选项失败只警告，不阻断评价主体，未显示的已选任务继续保留 | Done |
| `/teacher/classrooms/[classroomId]/ai-learning-analytics` | AI 反馈介入成效分析 | Analytics 总览 / ACTIVE 学生列表 / 任务选项 | 切换窗口、临时排除任务，查看班级/任务/学生 V1.1 分析；姓名/学号搜索、总体结果和参与阶段筛选仅作用于学生列表。分页、详情进入和返回保留筛选上下文，学生筛选/分页后定位学生分析区；区分无 ACTIVE 学生、筛选无结果和空分页。任务选项或学生列表失败局部降级，总览失败为页面错误；直接展示后端结果，不从学生分页重算摘要，不将总体结果当时间趋势或能力/因果结论 | Done |
| `/teacher/classrooms/[classroomId]/ai-learning-analytics/students/[studentId]` | 单学生 AI 反馈介入分析 | Analytics student detail API | 展示后端总体结果、参与阶段、逐任务 before/after 与全任务明细；不连接不同任务，不把不可比较值画为 0。列表筛选与页码仅用于返回并恢复学生分析区上下文，不改变详情数据范围 | Done |
| `/teacher/classrooms/[classroomId]/export/snapshot` | 教学快照预检（内部） | Snapshot export API | 调整统计窗口、逐任务范围与截断范围，查看预检摘要和截断提示；保留直达路由，不作为教师高频入口 | Done |

## 3) Student 路由

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 完成度 |
|---|---|---|---|---|
| `/student` | 学生入口 | 无数据依赖 | 重定向到学习看板 | Done |
| `/student/account` | 账户设置 | 当前用户 / 改密能力 | 查看本人资料、修改密码；无资料编辑 UI；可返回学习看板 | Done |
| `/student/dashboard` | 学习看板 | Student classroom dashboard API | 查看班级与任务、进入任务详情；默认当前和近期过期任务，可显式查看历史并保留分页视图。班级分页，卡片内完整展示后端可见任务；展示教师、课程、学期摘要，不暴露无关标识或联系方式。完成情况直接消费 completionStatus，模板当前状态不作为二次过滤或参与阻断依据 | Done |
| `/student/classrooms/join` | 加入班级 | Classroom join 能力 | 输入加入码入班，资格由后端判定 | Done |
| `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` | 学生任务详情与提交 | my-task-detail 聚合 / submission | 查看任务说明、评分标准、完成情况、历史提交与 AI 状态；completionStatus 由后端提供，不从反馈或 AI 状态推断。消费 participationStatus 的只读/可提交边界，旧响应缺字段保留可参与兜底；不以模板当前状态阻断。已截止且不允许迟交时禁用提交，允许迟交且有参与资格时可提交；成功后进入 submission detail | Done |
| `/student/submissions/[submissionId]` | 学生提交详情与反馈 | 正式 submission detail / feedback（[调用链](./handoff-frontend-api-map.md)） | 查看代码、反馈及迟交信息，在允许状态下请求 AI；可返回来源任务，导航上下文不作为主体数据 SoT；状态刷新职责见 Component Map | Done |
| `/student/help/ai` | AI 状态帮助 | 静态帮助内容 | 查看状态说明与排障建议 | Done |

## 4) 辅助路由（非主交付链）

| Route | 页面用途 | 主要数据 / 依赖 | 核心交互 / 边界 | 当前实现 |
|---|---|---|---|---|
| `/_demo/**` | demo 沙箱页 | 前端内存 demo 数据 | 与正式主链路解耦，仅用于演示 | demo-only |
| `/api/_demo/**` | demo 本地路由 | 前端内存数据，无后端 API | 不作为生产业务调用链 | demo-only |
| `/api/proxy/[...path]` | 正式 BFF 代理入口 | Backend API；实现见 [Frontend API Map](./handoff-frontend-api-map.md) | 正式业务主链路必经，业务页面不绕过代理 | 已接入 |

当前没有正式 `/ops/**` 前端页面；debug/ops 的后端接口与启用边界由 API Owner 维护。

## 5) Maintenance

- route 新增/删除、角色、页面用途、主要用户交互或 implementation state 变化时更新本文；以源码确认 Done/Partial，不复制 Roadmap 阶段状态。
- API helper、BFF、backend endpoint 或数据适配变化更新 Frontend API Map；本文仅同步受影响的高层依赖与页面语义。
- component responsibility、composition/state owner 变化更新 Component Map；稳定 UX/视觉原则更新 Design Baseline；testing evidence 更新 Testing Playbook。
- 跨层事实采用最低充分引用；submission detail 的主体读源、query 兼容与调用链统一回到 Frontend API Map，不在本文恢复独立数据源合同。
