# 前端路由地图（Route Map）

说明：

- 本文仅记录当前 `frontend/app/**` 实际存在路由。
- `/teacher/**` 与 `/student/**` 已由对应 layout 执行 server-side role gate：未登录重定向到 `/login`，角色不匹配展示 403 UI。
- 页面请求均经 `lib/api/client.ts` 或 `lib/api/browser-client.ts` 走 `/api/proxy/**`。
- `完成度` 口径：`Done`（主视图 + 主交互 + 真接口接入）、`Partial`（可访问但能力不完整）。
- `Done` 仅表示当前页面链路可用，不等于最终交付定版。

## 1) Auth 与入口

| Route | 页面用途 | 主接口（经 `/api/proxy/**`） | 关键交互 | 完成度 | 稳定读源/真接口 |
|---|---|---|---|---|---|
| `/` | 根入口 | - | 直接重定向到 `/login` | Done | - |
| `/login` | 登录页 + 角色分流 | `POST auth/login`、`GET users/me` | 登录、`next` 回跳、无角色提示 | Done | 真接口 |

## 2) Teacher 路由

| Route | 页面用途 | 主接口（经 `/api/proxy/**`） | 关键交互 | 完成度 | 稳定读源/真接口 |
|---|---|---|---|---|---|
| `/teacher` | 教师入口 | - | 重定向到 `/teacher/classrooms` | Done | - |
| `/teacher/courses` | 课程列表 + 创建课程 | `GET courses`、`POST courses`、`PATCH courses/:id`、`DELETE courses/:id` | 默认按 `进行中/已归档/全部` 视图区分展示（`statusView` query 驱动；列表请求在 `active/archived` 视图透传 `status=ACTIVE/ARCHIVED`）；创建支持可选 `courseLabel`（课程分类）；列表展示课程分类与状态标签；课程生命周期动作收进“更多”次级菜单（`ACTIVE: 归档/删除`，`ARCHIVED: 恢复/删除`）；删除作为危险次级操作，命中 `409 + COURSE_NOT_EMPTY` 时给出明确提示“该课程下已有班级记录，不能删除，只能归档”；操作后通过 `router.refresh()` 刷新并保持当前视图 query；空态动作按视图收口：`archived` 空态仅“查看进行中课程”，`active/all` 空态不再额外展示“创建课程” | Done | 真接口 |
| `/teacher/courses/[courseId]/overview` | 课程总览 | `GET courses/:courseId/overview` | 页面结构收口为“筛选区 -> 课程摘要 -> 班级明细 -> 分页 -> 调试区”；去除 `window/sort/order/page` 技术态裸文本回显；筛选区风格向学习轨迹/课堂复盘页对齐；前端主展示窗口收口为 `all/7d`（默认 `all`，旧值 `1h/24h/7d` URL 仍兼容）；摘要区按“有意义优先”瘦身为班级总数、当前页班级数、当前页有提交班级数、当前页平均提交率、当前页平均 AI 成功率；比率字段（摘要+表格）统一百分比展示；`顺序` 改为与 learning-trajectory 一致的单切换表达（点击翻转 `asc/desc`），并固定展示“当前窗口”提示（旧值带“旧链接兼容”标记）；表格区补充“班级指标按当前窗口内该班全部课堂任务汇总”的低干扰说明；新增低权重“查看原始 JSON”折叠调试入口（直接复用当前 overview 响应） | Done | 真接口 |
| `/teacher/courses/[courseId]/edit` | 课程编辑页 | `GET courses/:id`、`PATCH courses/:id` | 从课程列表/课程总览进入编辑；支持修改 `code/name/term/courseLabel`，保存后回课程总览；overview 保持展示页职责 | Done | 真接口 |
| `/teacher/tasks` | 任务模板页 | `GET learning-tasks/tasks`、`POST learning-tasks/tasks` | 默认 `scope=mine`；支持视图切换 `mine/shared/all` 并同步 URL；`scope/courseLabel/status/knowledgeModule/stage/page` 全部由 URL 驱动并透传后端真实查询；列表采用标准分页（固定 `limit=20`，上一页/下一页）；列表显示 `visibility(私有/共享)`；创建区不再暴露状态枚举，而是通过“保存为草稿 / 发布模板”两个动作提交 `status=DRAFT/PUBLISHED`；非作者模板仅显示“查看”入口，并基于 `publisher` 显示“模板发布者：姓名”（姓名缺失显示“其他教师模板”）；作者自己的 `DRAFT/PUBLISHED` 模板显示“编辑”，作者自己的 `ARCHIVED` 模板仅显示“查看”；默认排序按视图收口：`mine=最近更新优先`、`shared=PUBLISHED 优先`、`all=我的模板优先` | Done | 真接口 |
| `/teacher/tasks/[taskId]/edit` | 任务模板编辑/查看页 | `GET learning-tasks/tasks/:id`、`PATCH learning-tasks/tasks/:id`、`POST learning-tasks/tasks/:id/publish`、`POST learning-tasks/tasks/:id/archive` | 作者可编辑 DRAFT/PUBLISHED 模板核心字段（含可选 `courseLabel`、`visibility`）、维护 rubric 基础配置；普通保存不再提交 `status`；DRAFT 页显示“发布模板”，PUBLISHED 页显示“归档模板”，均二次确认后调用动作接口；作者打开 `ARCHIVED` 模板时页面只读，不显示保存/发布/归档/恢复按钮，并提示后续如需复用应复制为新草稿；非作者共享模板进入只读查看模式，并基于 `publisher` 显示模板发布者；保存失败时，若后端返回“已被课堂任务引用的 `PUBLISHED` 模板不能改回 `DRAFT`”错误，前端保留中文友好兜底；支持 `returnTo` 回跳上下文（优先返回原模板列表 URL，缺失/非法时回退 `/teacher/tasks`） | Done | 真接口 |
| `/teacher/classrooms` | 班级列表 + 创建班级 | `GET classrooms`、`GET courses`、`POST classrooms`、`PATCH classrooms/:id`、`DELETE classrooms/:id` | 默认按 `进行中/已归档/全部` 视图区分展示（`statusView` query 驱动；列表请求透传 `status`）；支持创建班级；班级生命周期动作收进“更多”次级菜单（`ACTIVE: 归档/删除`，`ARCHIVED: 恢复/删除`）；空态动作按视图收口：`archived` 空态仅“查看进行中班级”，`active/all` 空态不再额外展示“创建班级”；删除作为危险次级操作，命中 `409 + CLASSROOM_NOT_EMPTY` 时给出明确提示“该班级已有成员或任务记录，不能删除，只能归档”；操作后通过 `router.refresh()` 刷新并保持当前视图 query | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/edit` | 班级编辑页 | `GET classrooms/:id`、`PATCH classrooms/:id`、`POST classrooms/:id/archive` | 编辑班级基础信息（当前仅班级名称）；所属课程用 `ClassroomResponse.course` 摘要只读展示；`ACTIVE` 班级在危险操作区可二次确认后归档并回班级看板刷新，`ARCHIVED` 班级仅显示已归档提示；不提供恢复或删除动作 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]` | 班级入口 | - | 重定向到 dashboard | Done | - |
| `/teacher/classrooms/[classroomId]/dashboard` | 班级看板 | `GET classrooms/:id`、`GET classrooms/:id/dashboard` | 默认不传 `includeClosedTasks`，仅展示后端返回的 ACTIVE 任务；提供“显示已关闭任务”开关，打开后请求 `includeClosedTasks=true` 并展示 ACTIVE+CLOSED，CLOSED 行显示“已关闭”标签并弱化；任务标题列基于 `taskTemplateStatus` 仅对 `ARCHIVED` 显示“模板已归档”轻量标签，`DRAFT/PUBLISHED/null/未知值` 不显示；非本人模板基于 `taskPublisher` 显示“模板发布者：姓名”（姓名缺失显示“其他教师模板”）；任务标题第一行仅显示标题，`已关闭`、发布者标签、模板异常标签按纵向堆叠；统计完全以接口返回 summary 为准，不在前端二次过滤或重算；消费后端 `archiveSuggestion`，仅 `suggested=true` 时显示“建议归档”提示，前端不重算建议、不自动归档 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks` | 班级任务列表/发布页（班级实例层） | `GET classrooms/:id`、`GET classrooms/:id/tasks`、`GET classrooms/:id/publishable-task-templates`、`POST classrooms/:id/tasks`、`PATCH classrooms/:classroomId/tasks/:classroomTaskId/status`、`PATCH classrooms/:classroomId/tasks/:classroomTaskId` | 候选池由发布候选接口实时检索；`courseLabel/onlyMine/knowledgeModule/stage` 写入 URL 并透传后端查询；`courseLabel` 下拉选项来自统一标准课程分类列表（非候选结果倒推）；后端内置“仅 `PUBLISHED` + 排除本班已发布模板 + 课程优先排序”；首屏加载 `page=1&limit=50`，当 `total` 更大时支持“加载更多”追加后续页（非完整分页器）；筛选变化回到第一页并重置已追加候选；选择“当前教师可见的已发布模板（我的+可见共享）”并配置 `dueAt/allowLate/maxAttempts` 发布实例；模板候选列表与已选模板摘要都会基于 `publisher` 对非本人模板显示“模板发布者：姓名”（姓名缺失显示“其他教师模板”）；任务标题列不常驻展示模板状态枚举，仅基于 `task.taskStatus` 对 `ARCHIVED` 显示“模板已归档”轻量标签，`DRAFT/PUBLISHED/null/未知值` 不显示；非本人模板基于 `task.taskPublisher` 显示“模板发布者：姓名”（姓名缺失显示“其他教师模板”），且任务标题第一行仅显示标题，后续徽章按纵向堆叠；课堂任务生命周期、截止时间、提交窗口三类状态分开展示：`ACTIVE` 显示“开放中”，`CLOSED` 显示“已关闭”，`RECALLED` 显示“已撤回”；截止时间列单独显示“未截止/已截止/无截止时间/时间异常”；任务状态列内补充提交窗口辅助标签“可提交/允许迟交/不可提交/状态未知”（按 `status + dueAt + allowLate` 前端提示，不替代后端权限），不常驻展示状态解释长句；不展示课堂任务级“AI 状态”列，AI 情况通过三件套入口中的“AI 指标”查看；`ACTIVE` 可执行“关闭任务”，`CLOSED` 可执行“恢复提交”（`status=ACTIVE`），`ACTIVE/CLOSED` 可执行“编辑设置”（更新 `dueAt/allowLate/maxAttempts`），`RECALLED` 仅展示状态；进入详情/提交/三件套、跳模板页 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]` | 课堂任务详情 | `GET classrooms/:id`、`GET classrooms/:id/tasks/:classroomTaskId` | 只读展示课堂任务基础信息（任务名称、截止时间、允许迟交、发布时间、描述）与三件套/提交管理入口；不再展示底层模板 `task.taskStatus` 的“发布状态”，也不再提供“任务状态管理”区块或模板发布按钮；课堂任务实例状态管理仍留在班级任务列表页处理 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` | 课堂任务提交管理 | `GET classrooms/:id`、`GET classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 查看提交、跳转批阅页；顶部导航顺序为“班级看板 -> 返回任务列表 -> 返回任务详情 -> 学习轨迹 -> 课堂复盘 -> AI 指标”，其中“班级看板”跳 `/teacher/classrooms/[classroomId]/dashboard` | Done | P0 真接口 |
| `/teacher/submissions/[submissionId]` | 教师提交详情/批阅 | `GET learning-tasks/submissions/:id`、`GET learning-tasks/submissions/:id/feedback`、`POST learning-tasks/submissions/:id/feedback`、`PATCH learning-tasks/submissions/:submissionId/feedback/:feedbackId` | 查看代码与反馈、新增教师反馈；顶部导航收口为“班级看板 -> 返回任务提交列表 -> 返回任务详情”，其中“班级看板”仅在 query 存在 `classroomId` 时显示并跳 `/teacher/classrooms/[classroomId]/dashboard`，原“返回班级列表”已移除；新增与编辑字段口径统一为 `type/severity/message/suggestion/tags`，其中 `tags` 可选，不选由后端归一化为 `other`；反馈历史中仅 `source=TEACHER` 且有 `id` 的条目显示“修改”，支持原地编辑并保存后 `router.refresh()`；AI/SYSTEM 反馈只读；`scoreHint` 仅做响应兼容，不在教师前端展示或提交 | Done | 稳定读源 + 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` | 学习轨迹 | `GET .../learning-trajectory` | 主展示窗口 `all/7d`（默认 `all`）；兼容 URL 旧值 `24h/30d`（继续请求但不在主 tabs 展示）；window/sort/order/include* 切换；默认请求 `limit=100`，URL `limit` 最大允许 `100`；主表“错误数变化（最近 vs 首次）”显示增加/减少/无变化语义；`includeAttempts/includeTagDetails` 在主视图显示可见扩展区；attempts 中“总反馈”使用 `feedbackCount`（非 `feedbackSummary.totalItems`）；学生列表区域显示“共 X 名学生，当前显示 Y 名”；仅当 `total > limit` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”；顶部导航顺序为“班级看板 -> 返回任务列表 -> 提交管理”，其中“班级看板”跳 `/teacher/classrooms/[classroomId]/dashboard` | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` | 课堂复盘（证据型） | `GET .../review-pack` | 主展示窗口 `all/7d`（默认 `all`）；兼容 URL 旧值 `24h/30d`（继续请求但不在主 tabs 展示）；`window/topK/examplesPerTag` 切换；主视图聚焦总览/问题聚合/典型样例/学生分层；样例卡片可跳转对应提交详情；顶部导航顺序为“班级看板 -> 返回任务列表 -> 提交管理”，其中“班级看板”跳 `/teacher/classrooms/[classroomId]/dashboard` | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` | AI 指标 | `GET .../ai-metrics` | 窗口集合与默认值保持原策略（`1h/24h/7d`），仅做 window/includeTags 切换；顶部导航顺序为“班级看板 -> 返回任务列表 -> 提交管理”，其中“班级看板”跳 `/teacher/classrooms/[classroomId]/dashboard` | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/members` | 班级成员管理 | `GET classrooms/:id`、`GET classrooms/:id/students`、`POST classrooms/:id/students/:uid/remove` | 成员列表、移除成员；成员请求显式传 `page` 与固定 `limit=100`，页面展示“共 X 名成员，当前显示 Y 名”；`total > 100` 时显示轻量分页（第 N / M 页、上一页、下一页），`includeRemoved` 切换时回到 `page=1` | Done | P0 真接口 |
| `/teacher/classrooms/[classroomId]/weekly-report` | 班级周报 | `GET classrooms/:classroomId/weekly-report` | 页面已收口为汇总型分析页（筛选区 -> 周报摘要 -> 周报概览 -> 调试区）；主展示窗口 `7d/30d/all`（默认 `all`），兼容 URL 旧值 `24h`（继续请求但不在主 tabs 展示）；已移除空“周报明细”区块；`topTags` 仅在“风险与问题概览”展示一次；原始 JSON 入口保留且默认折叠 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/process-assessment` | 过程性评价 | `GET classrooms/:classroomId/process-assessment`、`GET classrooms/:classroomId/process-assessment.csv` | 页面已进一步收口为正式评价页表达（筛选区 -> 摘要区 -> 明细区 -> 调试区）；主展示窗口 `7d/30d/all`（默认 `all`），兼容 URL 旧值 `24h`（继续请求但不在主 tabs 展示）；摘要区聚合 5 项（学生人数/高风险人数/平均任务提交率/平均得分/AI 请求成功率）；明细表显式增加得分列，学生列主展示姓名并在有值时次级展示“学号：xxx”，教师可见区域不再直显 `studentId`，问题摘要列使用英文 `topTags` 的 `tag (count)` 表达并去除重复句式前缀，另保留基于 `rubric` 的低干扰评价口径说明；CSV 下载与原始 JSON 入口保持 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/export/snapshot` | 教学快照预检（内部） | `GET classrooms/:classroomId/export/snapshot` | 内部预检/诊断页：window/includePerTask/limit* 切换、查看 `meta.notes` 截断提示与预检摘要；保留直达路由，不作为教师高频主入口 | Done | 真接口 |

## 3) Student 路由

| Route | 页面用途 | 主接口（经 `/api/proxy/**`） | 关键交互 | 完成度 | 稳定读源/真接口 |
|---|---|---|---|---|---|
| `/student` | 学生入口 | - | 重定向到 `/student/dashboard` | Done | - |
| `/student/dashboard` | 学习看板 | `GET classrooms/mine/dashboard` | 查看班级与任务、跳任务详情；默认不传 `includeHistorical`，仅展示后端返回的当前任务与近期过期任务；提供“显示历史任务”开关，打开后请求 `includeHistorical=true`；班级标题区已接入后端 `classroom.teacher` 与 `classroom.course` 摘要，并在班级名后以轻量徽章展示“任课教师：{name}”“课程：{name}”“学期：{term}”；教师姓名、课程名或学期为空时分别显示“任课教师：未设置”“课程：未设置”“学期：未设置”；不展示 `teacher.id/employeeNo/email`，也不展示 `course.id/courseId/course.code/courseLabel`；`RECENTLY_EXPIRED` 显示“近期过期”标签，`HISTORICAL` 显示“历史任务”标签并弱化；任务列表 AI 状态列以中文标签展示；“完成情况”列直接展示后端 `completionStatus.status`（未提交/暂无反馈/已合格/基本合格/不合格）；前端不再按任务模板当前 `PUBLISHED/ARCHIVED` 状态做二次过滤或参与提示 | Done | 真接口 |
| `/student/classrooms/join` | 加入班级 | `POST classrooms/join` | 输入 joinCode 入班 | Done | 真接口 |
| `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` | 学生任务详情与提交页 | `GET .../my-task-detail`、`POST .../submissions` | 基于 `my-task-detail` 聚合结果展示任务基础信息、任务说明、评分标准与历史提交；顶部“最新 AI 状态”和历史提交 AI 状态均使用中文标签；顶部“完成情况”直接展示后端顶层 `completionStatus.status`（未提交/暂无反馈/已合格/基本合格/不合格），不从历史提交、反馈摘要、反馈明细或 AI 状态二次推断；接入顶层 `participationStatus`，`readOnly=true/canSubmit=false` 时显示只读提示并禁用提交入口，旧响应缺字段按可参与兜底；前端不再使用 `TASK_NOT_PUBLISHED` 或模板当前 `PUBLISHED/ARCHIVED` 状态控制只读/可提交；页面渲染时若已过 `dueAt` 且 `allowLate !== true`，提交区不展示可填写表单，改为禁用按钮与截止提示；`allowLate=true` 的已截止任务仍可展示提交表单；支持提交作业并进入 submission detail 查看反馈 | Done | 真接口 |
| `/student/submissions/[submissionId]` | 学生提交详情/反馈 | `GET learning-tasks/submissions/:id`、`GET learning-tasks/submissions/:id/feedback`、`POST learning-tasks/submissions/:submissionId/ai-feedback/request` | 查看代码与反馈、请求 AI；迟交时长按人性化单位展示，不直出大秒数 | Done | 稳定读源 + 真接口 |
| `/student/help/ai` | AI 状态帮助页 | - | 状态说明与排障建议 | Done | - |

## 4) 辅助路由（非主交付链）

| Route | 页面用途 | 接口 | 现状 |
|---|---|---|---|
| `/_demo/**` | demo 沙箱页 | `app/api/_demo/**` 内存接口 | 与主链路解耦，仅用于演示 |
| `/api/_demo/**` | demo 本地路由 | 不经过后端 | 非生产链路 |
| `/api/proxy/[...path]` | 正式代理层 | 转发到 `${FRONTEND_BACKEND_ORIGIN}/api/**` | 主链路必经 |

## 5) submission detail 口径说明（关键）

- Teacher/Student submission detail 主体数据均来自 `GET learning-tasks/submissions/:id`。
- URL query 透传目前仅承担：
  - 导航上下文（`classroomId/classroomTaskId`）用于回跳
  - 少量字段兜底展示（当 detail 字段缺失时）
- query 透传不再作为 submission 主体数据真相源。
