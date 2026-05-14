# 前端全局事实快照（Path Base: `frontend/`）

## 0) 事实前提（强制口径）

- 本快照以当前 `frontend/**` 工作区源码为准。
- 与会话结论、旧文档冲突时，代码优先。
- 前端接口访问默认走同域代理：`/api/proxy/**`。
- 代理目标由 `FRONTEND_BACKEND_ORIGIN` 决定，代理实现位于 `app/api/proxy/[...path]/route.ts`。
- 与后端对齐口径来自：
  - `docs/frontend-architecture.md`
  - `docs/handoff/handoff-api-map.md`
  - `docs/handoff/handoff-dto-cheatsheet.md`
  - `docs/handoff/handoff-decisions.md`
  - `docs/handoff/handoff-snapshot.md`
  - `docs/handoff/handoff-config-matrix.md`

## 1) 项目骨架（当前前端真实结构）

```text
frontend/
├─ app/
│  ├─ (auth)/login
│  ├─ teacher/**
│  ├─ student/**
│  ├─ api/proxy/[...path]          # 正式 BFF 代理
│  ├─ _demo/** + api/_demo/**      # 本地 demo 沙箱
│  └─ {layout,error,not-found,page}
├─ components/
│  ├─ layout/{TeacherShell,StudentShell}
│  ├─ blocks/{PageHeader,EmptyState,ErrorState,Tabs}
│  ├─ teacher/**                   # 课程/班级/模板创建编辑筛选/班级发布/教师反馈
│  ├─ student/**                   # 加班级/提交/请求AI/处理提示/提交详情与任务详情自动刷新
│  └─ classroomTask/TaskContextHeader
└─ lib/
   ├─ api/{client,browser-client,error-presenter,types-*}
   ├─ auth/{session,role-home}
   ├─ routes/paths.ts
   ├─ ui/{status,format,rubric}
   └─ http/server-cookie.ts
```

## 2) 路由分区与完成度（摘要）

- `/(auth)/login`：已完成登录与 role-home 跳转（`TEACHER -> /teacher/classrooms`, `STUDENT -> /student`）；页面已收口为极简专业型登录入口（主标题“重庆邮电大学智能化教学平台” + 聚焦登录表单），未改变登录链路与错误分流口径。
- `/teacher/**`：教师起步链路、模板链路、班级发布链路、批阅链路、三件套、周报/过程性评价/快照已接入真接口。
- 教师班级基础管理层（已落地）：
- `/teacher/classrooms`：班级列表 + 创建班级；默认按 `进行中/已归档/全部` 视图区分展示，操作列提供“进入班级/编辑班级”，班级生命周期动作统一收进“更多”次级菜单；主列表已默认请求 `page=1&limit=100`，切换 `statusView/courseId` 时回到 `page=1`，并展示“共 X 个班级，当前显示 Y 个”；仅当 `total > 100` 时显示轻量分页。
  - 班级生命周期菜单已改为 `Portal + fixed` 浮层（渲染到 `document.body`），脱离表格滚动容器，菜单展开不再撑出列表滚动条。
  - 班级列表空态动作已按 `statusView` 收口：页面主创建入口固定保留 `CreateClassroomForm`；`archived` 空态仅提供“查看进行中班级”动作；`active/all` 空态不再追加“创建班级”按钮，避免与主创建入口重复。
  - 班级生命周期操作已接入后端契约：
    - 归档/恢复：`PATCH classrooms/:id`（`status=ARCHIVED/ACTIVE`）
    - 删除：`DELETE classrooms/:id`（前端统一提供入口，失败时按后端 `409 + CLASSROOM_NOT_EMPTY` 显示“该班级已有成员或任务记录，不能删除，只能归档”）
  - `/teacher/classrooms/[classroomId]/edit`：班级基础信息编辑页，当前前端按后端契约仅支持更新 `name`（调用 `PATCH classrooms/:id`）；所属课程只读展示优先使用 `ClassroomResponse.course` 摘要（name/code/term/courseLabel），仅在摘要缺失时弱化显示 `courseId` 作为排查信息；页面说明文案已更新为中性口径，强调修改基础信息不会影响成员、课堂任务和历史提交；归档、删除等低频操作仍在班级列表 `/teacher/classrooms` 的“更多”菜单中处理，编辑页不再展示危险操作区块或归档入口；`Archived` 状态更新失败仍展示后端错误明细。
- 教师模板层（已落地）：
  - `/teacher/tasks`：模板列表 + 创建 + 视图切换（默认 `scope=mine`，支持 `mine/shared/all`）+ URL 驱动筛选（`scope/courseLabel/status/knowledgeModule/stage/page`）并展示模板可见性 `visibility(私有/共享)`；列表已切到后端真实查询与标准分页，现已默认请求 `page=1&limit=100`，筛选变化自动回到第一页，翻页继续保留 `fromClassroomId/status/scope/courseLabel/knowledgeModule/stage`；列表区展示“共 X 个任务模板，当前显示 Y 个”，仅当 `total > 100` 时显示轻量分页；创建区不再暴露状态枚举，而是通过“保存为草稿 / 发布模板”动作提交 `status=DRAFT/PUBLISHED`；默认排序按 scope 收口（`mine=最近更新优先`、`shared=PUBLISHED 优先`、`all=我的模板优先`）；作者自己的 `DRAFT/PUBLISHED` 模板显示“编辑”，作者自己的 `ARCHIVED` 模板仅显示“查看”，非作者仍仅可查看并基于 `publisher` 展示模板发布者来源。
  - `/teacher/tasks/[taskId]/edit`：模板编辑/查看与生命周期动作（含可选课程分类、模板可见性；非作者共享模板只读并显示模板发布者来源）；从模板页进入编辑时携带 `returnTo`（当前完整列表 URL），编辑页顶部/底部返回优先回到该地址，缺失或非法时回退 `/teacher/tasks`；普通保存不再提交 `status`；作者打开 `DRAFT` 模板时可执行 `POST learning-tasks/tasks/:id/publish`，作者打开 `PUBLISHED` 模板时可执行 `POST learning-tasks/tasks/:id/archive`；作者打开 `ARCHIVED` 模板时页面只读，不显示保存/发布/归档/恢复按钮，并提示后续如需复用应复制为新草稿。
- 教师班级实例层（已收口）：
  - `/teacher/classrooms/[classroomId]/tasks`：选择“当前教师可见且已发布”的模板并发布到班级实例；候选池改为实时调用 `GET classrooms/:id/publishable-task-templates`，筛选条件 `courseLabel/onlyMine/knowledgeModule/stage` 透传后端，后端内置“仅 PUBLISHED + 排除本班已发布模板 + 课程优先排序”，不承担模板创建/编辑；候选模板列表与已选模板摘要都会基于 `publisher` 对非本人模板显示发布者来源；已发布实例列表基于 `taskPublisher` 对非本人模板显示发布者来源，且任务标题下的多枚徽章按纵向堆叠展示。
  - 课堂任务实例列表已将生命周期状态、截止时间状态、提交窗口状态分开展示：`ACTIVE/CLOSED/RECALLED` -> `开放中/已关闭/已撤回`，其中 `ACTIVE` 仅表示未被教师关闭或撤回，不代表尚未截止；任务标题列不再常驻展示模板状态枚举，但会基于 `task.taskStatus` 仅对 `ARCHIVED` 显示“模板已归档”轻量标签，`DRAFT/PUBLISHED/null/未知值` 不显示；截止时间列单独展示 `未截止/已截止/无截止时间`（非法时间防御显示为“时间异常”）；任务状态列额外展示提交窗口辅助标签 `可提交/允许迟交/不可提交/状态未知`，并去除常驻解释文案，仅保留标签、必要操作与操作反馈；提交窗口标签仅由前端按 `classroomTask.status + dueAt + allowLate` 做列表提示，不改变真实提交权限。`ACTIVE` 任务可执行“关闭任务”（`PATCH classrooms/:classroomId/tasks/:classroomTaskId/status`，`status=CLOSED`），`CLOSED` 任务可执行“恢复提交”（同接口，`status=ACTIVE`），且 `ACTIVE/CLOSED` 任务可执行“编辑设置”（`PATCH classrooms/:classroomId/tasks/:classroomTaskId`，更新 `dueAt/allowLate/maxAttempts`）；`RECALLED` 仅展示状态，不提供恢复提交或编辑设置入口。恢复提交仅恢复状态，不自动修改 `dueAt/allowLate/maxAttempts`。
  - 课堂任务实例列表已移除低价值“AI 状态”列：classroomTask 本身没有单一 AI 状态，教师查看 AI 情况通过行内三件套入口的“AI 指标”（ai-metrics）下钻。
  - 候选池首屏仍由 server 侧请求 `page=1&limit=50`；发布表单支持“加载更多”按当前筛选追加后续页（非完整分页器）；筛选条件变化时重置回第一页并清空历史追加结果。
  - 下方已发布任务列表现已显式读取 URL `page`，并固定请求 `GET classrooms/:classroomId/tasks?page={当前页}&limit=100`；列表区展示“共 X 个课堂任务，当前显示 Y 个”，仅当 `total > 100` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”。
  - 任务列表页继续维持接口职责分层：上方候选模板区仍走 `publishable-task-templates`（`page=1&limit=50` + 加载更多），下方已发布任务列表仍走 `GET classrooms/:classroomId/tasks`；不与班级看板 `dashboard` 聚合接口合并。
  - 发布页“课程分类”下拉已改为复用统一标准课程分类列表（`lib/learning-tasks/course-labels.ts`），不再从当前已加载候选集合倒推选项。
- `/student/**`：学习看板、加入班级、任务详情、提交、submission detail、请求 AI 已接入真接口。
- `/_demo/**`：独立 demo 沙箱，使用 `app/api/_demo/**` 内存数据，不参与主链路交付，不应作为正式 Teacher/Student 主链路实现参考。

## 3) 关键公共机制（已落地）

- 统一路由常量：`lib/routes/paths.ts`（含 `paths.teacher.tasks`、`taskEdit`、`tasksFromClassroom`、`classroomEdit`）。
- 模板治理口径单一来源：
  - `lib/learning-tasks/course-labels.ts`：`courseLabel` 候选项与“未分类”显示口径（课程模块与任务模板模块复用同一来源）。
  - `lib/learning-tasks/template-visibility-scope.ts`：`visibility(PRIVATE/SHARED)` 与 `scope(mine/shared/all)` 值域、显示文案、normalize。
  - `lib/learning-tasks/template-list-sorting.ts`：模板列表默认排序策略（前端默认行为，非用户可配置项）。
- 统一状态文案：`lib/ui/status.ts`（含 `NOT_REQUESTED` 正常语义）。
- 统一 rubric 四维中文映射：`lib/ui/rubric.ts`（`functionality/correctness/codeStyle/design` 与中文文案的单一事实源，供 Teacher/Student 共同复用）。
- 统一错误展开：`lib/api/error-presenter.ts` + `components/blocks/ErrorState.tsx`。
- 空态组件：`components/blocks/EmptyState.tsx`。
- 浮层菜单组件：`components/blocks/FloatingMoreMenu.tsx`（班级/课程生命周期“更多”菜单共享，负责 Portal 渲染、位置钳制与统一关闭行为）。
- Role gate：
  - `lib/auth/session.ts` 使用 `GET users/me` 探针
  - `app/teacher/layout.tsx` / `app/student/layout.tsx` 角色门禁
- submission detail 稳定读源接入：
  - 教师页 `app/teacher/submissions/[submissionId]/page.tsx`
  - 学生页 `app/student/submissions/[submissionId]/page.tsx`
  - 主体数据均由 `GET learning-tasks/submissions/:id` 拉取，query 透传当前主要承担：
    - 返回链路上下文（如 `classroomId` / `classroomTaskId`）用于回跳
    - 极少量短期 fallback 展示
  - query 透传不再作为 submission detail 主体数据真相源。

## 4) 当前主链路状态

Teacher 起步与模板链路（可用）：
1. `CreateCourseForm` -> `POST courses`
2. `CreateClassroomForm` -> `POST classrooms`；在 `/teacher/classrooms` 可执行班级生命周期操作（归档/恢复/删除），必要时进入 `/teacher/classrooms/[classroomId]/edit` 维护班级名称；空态不再重复平铺“创建班级”入口
3. `/teacher/tasks` 进行模板创建/筛选，必要时进入 `/teacher/tasks/[taskId]/edit` 维护模板状态与 rubric
   - 模板层已接入 `courseLabel`（课程分类）与 `visibility`（私有/共享）字段：创建/编辑可维护，列表可筛选并展示；`courseLabel` 与 `visibility` 都是模板治理字段，不绑定课程。
   - 模板列表默认 `scope=mine`，并支持显式切换 `mine/shared/all`；共享只影响读可见性，不改变作者权限边界。
   - 模板筛选已统一走后端真实查询：`scope/courseLabel/status/knowledgeModule/stage` 透传 `GET learning-tasks/tasks`；页面标准分页使用 `page` query（固定 `limit=100`），筛选变化自动重置到第一页。
   - 模板列表默认排序已前端收口：`mine` 按最近更新时间降序（同时间按创建时间）；`shared` 先 `PUBLISHED` 再按最近更新时间；`all` 先“我的模板”再“他人共享模板”。
4. `/teacher/classrooms/[classroomId]/tasks` 选择当前可见且已发布模板（我的 + 可见共享）并设置 `dueAt/allowLate/maxAttempts` 后发布（`POST classrooms/:id/tasks`）；候选池由 `GET classrooms/:id/publishable-task-templates` 按 query 实时检索，`courseLabel/onlyMine/knowledgeModule/stage` 均为后端真实查询条件，且后端已内置排除本班已发布模板
   - 首次仅加载第一页（`page=1&limit=50`），当 `total` 大于当前已加载数量时可在表单内“加载更多”并追加候选；筛选条件变化后回到第一页结果。
   - `courseLabel` 下拉使用标准分类全集，选择后通过 URL query 触发后端重查；加载更多不会改变下拉选项集合。
   - 班级实例列表中支持行内“编辑设置”，用于更新已发布课堂任务的实例级参数（`dueAt/allowLate/maxAttempts`）；该能力与模板编辑解耦，仅在 `ACTIVE/CLOSED` 状态开放。
5. 进入 `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/*` 和提交管理页
   - 课堂任务详情页已移除历史遗留的模板发布状态管理区块，不再展示底层模板 `task.taskStatus` 的“发布状态”，也不再提供模板发布按钮；模板生命周期统一回到 `/teacher/tasks/[taskId]/edit` 处理，课堂任务实例状态流仍由班级任务列表页负责。

Teacher 课程视角（可用）：
- `/teacher/courses` 已支持课程列表与创建课程，`courseLabel`（课程分类）可选录入并在列表展示；默认按 `进行中/已归档/全部` 视图区分展示课程（`statusView` query）；主列表已默认请求 `page=1&limit=100`，切换状态视图时回到 `page=1`，并展示“共 X 门课程，当前显示 Y 门”；仅当 `total > 100` 时显示轻量分页。
- 课程生命周期操作已接入后端契约，统一收进“更多”次级菜单：
  - 归档/恢复：`PATCH courses/:id`（`status=ARCHIVED/ACTIVE`）
  - 删除：`DELETE courses/:id`（前端统一提供入口，失败时按后端 `409 + COURSE_NOT_EMPTY` 显示“该课程下已有班级记录，不能删除，只能归档”）
- 课程生命周期菜单已改为 `Portal + fixed` 浮层（渲染到 `document.body`），脱离表格滚动容器，菜单展开不再撑出列表滚动条。
- 课程空态动作已按 `statusView` 收口：页面主创建入口固定保留 `CreateCourseForm`；`archived` 空态仅提供“查看进行中课程”动作；`active/all` 空态不再追加“创建课程”按钮，避免与主创建入口重复。
- `/teacher/courses/[courseId]/overview` 已收口为“筛选区 -> 课程摘要 -> 班级明细 -> 分页”的层次化结构；移除 `window/sort/order/page` 技术态参数裸露展示，筛选区风格向学习轨迹/课堂复盘页对齐。
- 课程总览页前端主展示窗口已收口为 `all/7d`（默认 `all`）；旧值 URL（`1h/24h/7d`）仍兼容请求与展示，但主控件仅展示 `all/7d`。
- 课程总览页班级明细默认请求 `limit=100`，URL `limit` 最大允许 `100`；切换 `window/sort/order` 时回到 `page=1`，翻页保留当前 `window/sort/order/limit`；明细区展示“共 X 个班级，当前显示 Y 个”，仅当 `total > limit` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”。
- 课程总览页轻量摘要区已按“有意义优先”收口（复用既有 overview 数据契约，不新增接口）：班级总数（`total`）、当前页班级数、当前页平均任务完成度（`overallSubmissionCoverage`）、当前页平均 AI 成功率（跳过无 AI 活动班级）。
- 课程总览页比率字段已统一为百分比展示，并做展示层精度收口（最多 1 位小数，不暴露长小数）；明细主指标已切换为 `overallSubmissionCoverage`（表头“任务完成度”），旧 `submissionRate` 降级为次级语义“学生触达率（至少提交一次占比）”。
- 课程总览页筛选区已进一步向学习轨迹/课堂复盘页对齐，`顺序` 已改为与 learning-trajectory 同款单切换链接（点击在 `asc/desc` 间翻转并显示当前值）；筛选区固定展示“当前窗口”提示，命中旧窗口值时追加“旧链接兼容”标记；排序字段已接入 `overallSubmissionCoverage`，默认排序切到 `overallSubmissionCoverage desc`。
- 课程总览页班级明细区已补充口径说明：任务完成度/学生触达率/AI 成功率/AI 待处理/AI 失败等班级指标均按当前窗口内该班全部课堂任务汇总；无 AI 活动班级的 AI 成功率显示 `—`，避免误读为 `0%`。
- 课程总览页已新增低权重折叠调试区“查看原始 JSON”，样式对齐现有看板/三件套调试块，内容直接复用当前 overview 响应（`viewModel.data.raw`），未新增后端接口。
- `/teacher/courses/[courseId]/edit` 已支持课程基础信息编辑（`code/name/term/courseLabel`）；`courseLabel` 可修改也可清空。
- 课程视角可作为进入班级创建/班级管理的上游入口（跳转到 `/teacher/classrooms` 或带 `courseId` 的班级页）。

Teacher 班级看板链路（可用）：
1. `/teacher/classrooms/[classroomId]/dashboard` 已保持真接口读取（`GET /api/classrooms/:id` + `GET /api/classrooms/:id/dashboard`）；默认不传 `includeClosedTasks`，沿用后端默认只返回 ACTIVE 课堂任务。
2. 顶部概览已收口为 `summary.studentsCount`、`summary.publishedTasksCount`、`summary.lateStudentsTotal` 三个核心指标，不再使用与班级看板语义弱相关的占位值展示。
3. 任务明细表已补齐“提交进度（distinctStudentsSubmitted / studentsCount）”、“AI 处理概况（成功/失败/排队/处理中/终止/未请求）”与 `topTags` 前 2~3 项摘要。
4. 页面新增“显示已关闭任务”开关：关闭时请求默认 dashboard；打开时请求 `includeClosedTasks=true`，由后端返回 ACTIVE+CLOSED 数据集。前端不通过本地过滤模拟默认隐藏，也不重算 summary。
5. 任务行消费 `classroomTaskStatus`；当值为 `CLOSED` 时显示“已关闭”标签并做轻量弱化，未知状态不当作已关闭处理。
6. 任务标题列消费 `taskTemplateStatus`：仅 `ARCHIVED` 显示“模板已归档”轻量标签，`DRAFT/PUBLISHED/null/未知值` 不显示模板状态标签。
7. 任务标题列消费 `taskPublisher`：仅非本人模板显示“模板发布者：姓名”，姓名缺失显示“其他教师模板”，不显示 ID/email；任务标题、`已关闭`、发布者标签、模板异常标签按纵向堆叠展示，避免多枚徽章横向拥挤。
7. 页面接入后端顶层 `archiveSuggestion`：仅当 `suggested=true` 时在概览上方显示温和的“建议归档”提示，正文优先使用后端 `message`，并展示最近提交/连续无近期活动天数；前端不根据 tasks/dueAt/submissions/includeClosedTasks 重算建议，也不自动归档。
8. 每行任务已新增三类快捷入口：`提交记录`（submissions）、`课堂复盘`（review-pack）、`AI 指标`（ai-metrics），用于从看板直接下钻。
9. “教学快照”已从看板高频入口中移除，不再与周报/过程性评价同层暴露。

Teacher 班级成员链路（可用）：
1. `/teacher/classrooms/[classroomId]/members` 继续使用 `GET /api/classrooms/:id/students` 作为主读源，但前端已显式传入 `page` 与固定 `limit=100`，不再只依赖后端默认分页大小。
2. 页面 query 当前读取 `includeRemoved` 与 `page`；`limit` 固定为 `100`，不对外暴露每页数量切换。
3. 页面会展示成员数量摘要：`共 X 名成员，当前显示 Y 名`；其中 `Y` 直接使用当前响应 `items.length`。
4. 当 `total <= 100` 时，不显示分页按钮；当 `total > 100` 时，页面在表格下方显示轻量分页：`第 N / M 页`、`上一页`、`下一页`。
5. `显示已移除成员` 开关语义不变，切换时会回到 `page=1`；成员移除/恢复等既有操作语义不变。
6. 本次仅接入轻量真实分页，不新增搜索、不新增每页数量切换、不新增展开全部/收起，不改 backend 或接口契约。

Student 学习链路（可用）：
1. `/student/classrooms/join` -> `POST classrooms/join`
2. `/student/dashboard` -> `GET classrooms/mine/dashboard`
   - 页面新增“显示历史任务”链接式开关：默认不传 `includeHistorical`，打开后访问 `/student/dashboard?page=1&includeHistorical=true` 并请求 `classrooms/mine/dashboard?page=1&limit=100&includeHistorical=true`，关闭后恢复默认请求；切换 `includeHistorical` 时回到 `page=1`。
   - 班级卡片列表现已显式读取 URL `page`，并固定请求 `page={当前页}&limit=100`；页面显示“共 X 个班级，当前显示 Y 个”，当 `total <= 100` 时不显示分页按钮，当 `total > 100` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”。
   - 班级标题区已接入后端 `classroom.teacher` 与 `classroom.course`：在班级名后显示轻量徽章“任课教师：{teacher.name}”“课程：{course.name}”“学期：{course.term}”；当对应字段为 `null`、空字符串或缺失时分别回落为“任课教师：未设置”“课程：未设置”“学期：未设置”。
   - 学生端只展示教师姓名、课程名、学期文案，不展示 `teacher.id`、`teacher.employeeNo`、email、`course.id`、`courseId`、`course.code`、`courseLabel` 或其它课程管理字段。
   - 任务可见性完全消费后端 `studentVisibilityStatus/isHistorical`：`RECENTLY_EXPIRED` 显示“近期过期”标签，`HISTORICAL` 显示“历史任务”标签并轻量弱化；`CURRENT` 或旧响应缺字段不额外显示标签。
   - 学生看板不再按任务模板当前 `PUBLISHED/ARCHIVED` 状态做前端二次过滤；已发布课堂任务是否展示，以后端返回的 classroom/classroomTask/enrollment 运行态结果为准。
   - 本次分页仅作用于班级卡片列表 `items` 层级；每个班级卡片内部 `tasks` 继续完整展示后端返回的可见任务，不分页、不截断，也不新增“展开全部 / 收起”。
   - 前端不按 `dueAt/publishedAt/classroom.status/classroomTask.status` 自行判断历史任务，不用本地 filter 模拟默认隐藏；任务集合、`total/page/limit` 与统计展示均以接口返回为准。
   - 任务列表的 AI 状态列已改为中文标签展示：未提交、未请求、排队中、生成中、已生成、生成失败、已终止；不再在该页显示 `SUCCEEDED（已生成）` 这类中英文混排。
   - 任务列表新增“完成情况”列，直接消费后端 `task.completionStatus.status`：未提交、暂无反馈、已合格、基本合格、不合格。
   - 完成情况仅展示后端返回结论；前端不根据 `aiFeedbackStatus`、`mySubmissionsCount`、历史提交或额外接口二次推断合格/不合格。
   - 兼容旧响应：缺少 `completionStatus` 时，无最新提交显示“未提交”，有最新提交显示“暂无结论”。
3. `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` -> `GET .../my-task-detail`（页面已是“任务详情 + 提交工作台”，正式展示任务基础信息、任务说明 `task.description`、评分标准 `task.rubric`，并保留提交与历史记录；标题区不再展示“班级状态”占位文案，仅保留班级名称）
   - 页面顶部“最新 AI 状态”和提交记录表“AI 状态”均以中文标签展示：未提交、未请求、排队中、生成中、已生成、生成失败、已终止；不再显示 `SUCCEEDED（已生成）` 这类中英文混排。
   - 页面顶部新增“完成情况”，直接消费后端顶层 `completionStatus.status`：未提交、暂无反馈、已合格、基本合格、不合格；前端不根据 `submissions[]`、`latest.feedbackSummary`、`latest.feedbackItems` 或 `aiFeedbackStatus` 二次推断合格/不合格。
   - 兼容旧响应：缺少 `completionStatus` 时，无 latest 显示“未提交”，有 latest 显示“暂无结论”。
   - 已接入后端顶层 `participationStatus`：`readOnly=true` 时显示“当前为只读模式”提示；`canSubmit=false` 时提交入口渲染为不可点击禁用态；旧响应缺字段时按可参与兜底。
   - 只读态只消费后端 `participationStatus`，前端不按 `classroom.status/classroomTask.status/task.status` 自行拼门禁规则，也不把 `dueAt/allowLate/cooldown/NOT_REQUESTED` 混入状态层只读判断。
   - 学生任务详情页不再将“模板未发布/模板已归档”作为只读原因；模板当前状态不控制学生参与，运行态由 classroom/classroomTask/enrollment 与时间窗口决定。
   - 学生端类型层仍兼容解析旧 `TASK_NOT_PUBLISHED` reason，但前端不再基于该 reason 输出只读文案或额外阻断。
   - 提交区额外基于 `classroomTask.dueAt + settings.allowLate` 做前端体验拦截：页面渲染时已过截止时间且 `allowLate !== true` 时，不展示可填写提交表单，改为禁用提交入口并提示“该任务已截止，且教师未允许迟交，不能继续提交。”；`allowLate=true` 的已截止任务仍展示提交表单，最终权限仍以后端为准。
   - 已接入 AI 状态联动自动刷新：当提交列表中存在 `PENDING/RUNNING/FAILED` 时自动刷新；其中 `PENDING/RUNNING` 快速刷新、仅 `FAILED` 时慢速刷新；当提交列表全部进入非活跃状态（如 `SUCCEEDED/DEAD/NOT_REQUESTED`）时停止。
   - 自动刷新覆盖“最新 AI 状态”与提交记录表“AI 状态”列，使用整页刷新链路同步更新；页面不可见/失焦时暂停，回到前台后按当前状态恢复。
   - 终态收尾口径已修正：自动刷新驱动改为对齐“latest + submissions”真实状态来源，并在活跃态结束时保留一次最小收尾刷新，`DEAD` 可在自动刷新过程中自然显示，不再依赖手工刷新。
4. `SubmissionForm` -> `POST .../submissions`（language 默认“自动识别”，未手动指定时提交 `auto`，不再默认 `javascript`）
5. `/student/submissions/[submissionId]` -> 稳定读源 + feedback 列表 + request AI
   - 反馈主列表已中文化：表头使用“来源/类型/严重程度/反馈内容/修改建议/标签/时间”。
   - `source/type/severity` 在列表单元格按后端原值直出（英文枚举不翻译）；`message` 与 `suggestion` 分列展示（`suggestion` 为空时显示“暂无”）。
   - 迟交时长展示已从原始秒数改为人性化时长，最多展示两个主要单位（如 `37 天 22 小时`），避免大秒数直出。
   - 学生端“请求 AI 反馈”按钮仅在 `NOT_REQUESTED` 可点击；`FAILED` 状态已禁用，不再提供前端手工重试入口（失败后的后续处理由任务机制/worker 负责）。
   - 学生提交详情页已接入“状态驱动自动刷新”：`PENDING/RUNNING` 快速刷新、`FAILED` 慢速刷新；到 `SUCCEEDED/DEAD/NOT_REQUESTED` 自动停止；页面失焦或标签页不可见时暂停，回到前台后按当前状态恢复；同页实例内通过本地互斥避免刷新重叠。
   - `RequestAiFeedbackButton` 状态展示已与页面最新服务端状态同步：自动刷新后若状态变化（如 `RUNNING/FAILED -> DEAD`），按钮文案与提示会跟随更新，不再滞留旧状态文案。

Teacher 批阅链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions`
   - 页面现已显式读取 URL `page`，并固定请求 `page={当前页}&limit=100`。
   - 提交列表区域展示“共 X 条提交，当前显示 Y 条”；当 `total <= 100` 时不显示分页按钮，当 `total > 100` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”。
2. `/teacher/submissions/[submissionId]`（稳定读源）
   - 顶部导航已收口为：`班级看板 -> 返回任务提交列表 -> 返回任务详情`；其中“班级看板”仅在 query 中存在 `classroomId` 时显示，跳转 `/teacher/classrooms/[classroomId]/dashboard`。
   - 原 `返回班级列表` 入口已移除；本次不做 review-pack 来源追踪，不新增“返回课堂复盘 / 返回 AI 指标 / 返回学习轨迹”。
3. `TeacherFeedbackForm` -> `POST learning-tasks/submissions/:id/feedback`
   - 新增教师反馈表单已补齐 `type` 选择；当前新增字段口径统一为 `type/severity/message/suggestion/tags`。
   - `tags` 可选，前端不做必填校验；不选择时继续不提交 `tags`，由后端归一化为 `other`，教师端仅提示该规则。
   - `scoreHint` 作为后端响应兼容字段保留在前端类型与 mapper 中，但教师前端暂不展示、不新增、不提交。
4. `TeacherFeedbackHistory` + `TeacherFeedbackEditForm` -> `PATCH learning-tasks/submissions/:submissionId/feedback/:feedbackId`
   - 反馈历史中仅 `source=TEACHER` 且有 `id` 的条目显示“修改”入口；AI/SYSTEM 反馈保持只读。
   - 点击“修改”后在当前条目内原地展开编辑表单，支持 `type/severity/message/suggestion/tags`；保存成功后执行 `router.refresh()` 并退出编辑态。
   - 编辑表单中的 `tags` 同样可选；反馈历史继续按既有口径展示原始枚举值，不单独将 `other` 中文化。
   - `scoreHint` 暂不作为教师日常操作项展示或提交，避免被误读为正式评分。
   - 前端仅做基础入口与表单校验，不根据 `createdBy` 强判权限；403/404/400/5xx 按状态展示明确中文错误摘要并保留后端 detail。
5. 提交管理页中 `attemptNo` 的前端展示语义已收口为“该学生在当前 classroomTask 下的第几次提交”（表头“本任务第几次提交”），并在页内明确“不跨班级累计”；数据来源仍直接使用接口返回值。
   - `tags` 已改为标准标签多选（镜像后端统一词表），移除自由手写输入。
   - `message` / `suggestion` 保持自由文本输入；未选择标签时沿用后端兜底口径。
   - 若后端返回 `400/Invalid tag(s), please select from predefined tags`，前端显示中文摘要“标签无效，请从预设标签中选择”。 

Teacher 学习轨迹链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory`
2. 主表保留摘要列（学生/尝试次数/最近尝试时间/最近 AI 状态/错误数变化）。
3. `错误数变化（最近 vs 首次）` 已在单元格明确展示 `增加/减少/无变化` 语义。
4. `includeAttempts/includeTagDetails` 已在主视图提供可见扩展区（尝试详情、首次标签/最近标签），不再仅体现在请求参数与 raw JSON。
5. attempts 扩展区“总反馈”已消费 `attempt.feedbackCount`（全来源总反馈数）；`feedbackSummary.totalItems` 仅作为 AI 摘要信息展示，不再充当总反馈数。
6. 学习轨迹页顶部导航已补齐“班级看板”入口，当前顺序为：`班级看板 -> 返回任务列表 -> 提交管理`；跳转目标统一为 `/teacher/classrooms/[classroomId]/dashboard`，原有“返回任务列表”“提交管理”均保留。
7. 学习轨迹页默认请求 `limit=100`，URL `limit` 最大允许 `100`；学生列表区域展示“共 X 名学生，当前显示 Y 名”。
8. 当 `total <= limit` 时不显示分页按钮与 `第 1 / 1 页`；当 `total > limit` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”，翻页继续保留 `window/sort/order/includeAttempts/includeTagDetails/limit` 等当前 query 状态。

Teacher AI 指标链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` 保持真接口与 query 协议（`window/includeTags`）不变。
2. 筛选区窗口文案已统一为“统计窗口：1h（近1小时）/24h（近24小时）/7d（近7天）”风格，减少工程化简写歧义。
3. `summary.avgAttempts` 前端文案已收口为“AI 平均重试次数”，避免被误读为学生提交尝试次数。
4. `summary.avgLatencyMs` 在当前为 `null` 时不再作为主 KPI 卡片展示，改为“平均耗时指标当前暂未采集”说明文案。
5. AI 指标页顶部导航已补齐“班级看板”入口，当前顺序为：`班级看板 -> 返回任务列表 -> 提交管理`；跳转目标统一为 `/teacher/classrooms/[classroomId]/dashboard`，原有“返回任务列表”“提交管理”均保留。

Teacher 班级周报链路（可用）：
1. `/teacher/classrooms/[classroomId]/weekly-report` 已收口为汇总型分析页结构：筛选区（时间窗口）-> 周报摘要 -> 周报概览 -> 原始 JSON 调试区。
2. `summary` 与 `overview` 已做前端友好化映射，不再直出技术态 `Object.entries`/键值列表；比率类字段统一为百分比展示。
3. 页面已移除空的“周报明细”区块；在当前后端 weekly-report 契约下，不再渲染伪明细表，避免空盒子与重复信息。
4. 时间窗口策略保持不变：主展示 `7d/30d/all`（默认 `all`），旧值 URL `24h` 仍兼容请求且提供轻量提示，不回退到主 tabs。
5. `topTags` 等问题聚合信息继续只在“风险与问题概览”中展示，不在页面其它区块重复渲染。
6. “查看原始周报 JSON”入口继续保留，默认折叠并置于页面下方，作为低权重调试辅助。

Teacher 过程性评价链路（可用）：
1. `/teacher/classrooms/[classroomId]/process-assessment` 已从最小接口展示收口为正式分析页结构：筛选区（时间窗口）-> 过程性评价摘要 -> 过程性评价明细 -> 原始 JSON 调试区。
2. 页面摘要区已精修为更贴学生级评价语义的 5 项：学生人数、高风险学生数、平均任务提交率、平均得分、AI 请求成功率（均基于当前窗口与当前返回明细聚合）。
3. 明细表已显式增加“得分”列（展示 `score`）；并继续使用 view-model 友好化渲染：学生列主展示 `studentName`，次级仅在 `studentNo` 存在时展示“学号：{studentNo}”，不再向教师可见界面直显 `studentId`；其余保持进度百分比、风险中文标签（高/中/低风险）与问题摘要，不再在 JSX 中堆叠多层 `safeGet(...)` 兜底表达。
4. `topTags` 问题摘要已统一使用英文原标签（不再做不完整中文映射）；备注列优先展示真实备注，无备注时回退 `tag (count)` 摘要并默认最多展示前 3 个标签方向，避免中英混用。
5. 页面已新增低干扰“评价口径说明”（基于 `rubric` 权重）：任务提交率、提交次数、AI 请求质量代理、代码质量代理。
6. 时间窗口策略保持不变：主展示 `7d/30d/all`（默认 `all`），旧值 URL `24h` 继续兼容并提供轻量提示。
7. 页面现已显式读取 URL `page`，并固定请求 `page={当前页}&limit=100`；切换 `window` 时回到 `page=1`。
8. 明细表区域展示“共 X 名学生，当前显示 Y 名”；当 `total <= 100` 时不显示分页按钮，当 `total > 100` 时显示轻量分页“第 N / M 页 / 上一页 / 下一页”。
9. CSV 下载与“查看原始过程性评价 JSON”入口继续保留，且 JSON 调试区默认折叠、低权重展示；明细说明已更新为“超过 100 人时可翻页查看，完整结果可通过 CSV 导出。”。
8. 展示层三次抛光已完成：摘要区卡片密度更紧凑、问题摘要列去除重复句式前缀、表格主次层次（进度/得分主值与次级说明）进一步收口，筛选区“统计生成于”已弱化为更低权重信息。
9. 页面顶部高频操作区已移除“教学快照”显性跳转，避免将快照页继续塑造成正式业务同级入口。

Teacher 教学快照预检页（内部）：
1. `/teacher/classrooms/[classroomId]/export/snapshot` 路由与后端接口能力保持，页面定位已降级为“教学快照预检（内部）”。
2. 页面主文案统一为导出前核对/内部诊断语义，不再使用“正式导出页”表述，避免误导为即时下载中心。
3. 信息架构收口为“预检参数 -> 体积保护提示 -> 元信息/摘要 -> 原始快照数据（调试/核对用）”，其中原始 JSON 区块继续默认折叠、低权重展示。

Teacher 统计窗口策略（阶段二已收口）：
1. 班级级页面（`weekly-report`、`process-assessment`）前端主展示窗口为 `7d/30d/all`，默认窗口为 `all`。
2. 单任务页面（`learning-trajectory`、`review-pack`）前端主展示窗口为 `all/7d`，默认窗口为 `all`。
3. 旧链接兼容继续保留：班级级页面允许 URL `window=24h`，单任务页面允许 URL `window=24h/30d`；兼容值可继续请求后端并正常展示数据，但不再出现在主 tabs 中。
4. `process-assessment.csv` 下载沿用当前页面 `window` 参数（含旧值兼容场景），确保与页面 JSON 统计窗口一致。
5. `ai-metrics` 页面窗口集合与默认值保持原样（`1h/24h/7d`），本阶段未调整为 `all`。

Teacher 课堂复盘链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` 保持真接口与 query 协议（`window/topK/examplesPerTag`）不变，`studentTiers` 为固定返回域。
2. 页面主路径已收敛为“课堂总览 -> 课堂结论摘要 -> 高频问题概览 -> 典型样例 -> 学生分层 -> 原始数据（调试）”。
3. 页面已移除 `actionItems` 与 `teacherScript` 相关区块，不再展示“行动建议/教学脚本”。
4. `Top Tags/Top Types/Top Severities` 与筛选标签已中文化；原始 JSON 调试块保留但默认折叠。
5. 页面顶部保留“课堂总览”指标卡（提交覆盖、AI 成功率、逾期情况、样例数量、尝试分布）；典型样例已切换为消费后端去重样例池（`examples[*]`），并展示主标签/命中标签/严重程度/类型/反馈内容/修改建议。
6. 学生分层项主文案已改为 `studentName`（可附 `studentNo`），不再把 `studentId` 作为教师可见文本；`good/watch` 继续展示 `attemptsCount/latestErrorCount`，`notSubmitted` 仅展示学生身份信息。
7. 典型样例卡片已新增“查看对应提交”入口，复用现有 `teacher/submissions/[submissionId]` 路由，并附带 `classroomId/classroomTaskId` 回跳上下文参数。
8. “课堂结论摘要”已收紧为教师决策向的综合结论（覆盖与尝试态势 / 主问题方向 / 学生分层关注点），不再逐项复述“高频问题概览”的标签、类型、严重度榜单。
9. 筛选区文案已明确 `topK` 的榜单语义（“问题榜单条数”）；“尝试分布”卡片已改为左对齐小条形分布（`0次/1次/2次/3+次` 四档同时可见，条长按人数相对比例展示，右侧显示人数），不再使用单一大号主值；学生分层改为“每组默认前 6 条 + 分组内展开全部/收起”，并在组标题展示总人数。
10. 课堂复盘页顶部导航已补齐“班级看板”入口，当前顺序为：`班级看板 -> 返回任务列表 -> 提交管理`；跳转目标统一为 `/teacher/classrooms/[classroomId]/dashboard`，原有“返回任务列表”“提交管理”均保留。

Teacher 课堂任务工作区导航补强（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` 顶部导航已补齐“班级看板”入口，当前顺序为：`班级看板 -> 返回任务列表 -> 返回任务详情 -> 学习轨迹 -> 课堂复盘 -> AI 指标`。
2. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory`、`/review-pack`、`/ai-metrics` 顶部导航均已补齐“班级看板”入口，当前顺序统一为：`班级看板 -> 返回任务列表 -> 提交管理`。
3. “班级看板”统一使用 `paths.teacher.classroomDashboard(classroomId)`，不新增接口、不改变数据加载、筛选、图表、表格、空态、错误态或加载态逻辑。
4. 本次仅补强课堂任务工作区子页面返回班级级中枢的路径；班级看板快捷入口、任务列表页三件套入口与提交管理页原有横向入口均保持现状。

## 5) P0 真接口前端收口情况（现状）

已接入并在页面使用：

- `GET /api/users/me`：登录态探针 + role gate。
- `GET /api/classrooms/:id/students`：成员页主读源。
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：教师提交管理页主读源。
- `GET /api/learning-tasks/submissions/:id`：Teacher/Student submission detail 主读源（稳定读源）。
- `GET /api/learning-tasks/tasks` + `POST /api/learning-tasks/tasks`：模板页列表与创建（前端已接入 `scope` 查询与 `visibility` 创建字段）。
- `GET /api/learning-tasks/tasks/:id` + `PATCH /api/learning-tasks/tasks/:id`：模板编辑页详情与更新（前端已接入 `visibility` 回填/更新与非作者只读查看）。
- `POST /api/classrooms/:id/tasks`：班级任务实例发布。

补充：

- `PATCH /api/users/me` 后端已可用，但当前前端未提供资料编辑 UI 入口。

## 6) AI 闭环联调模式（默认）

前端产品动作：

- `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`（学生提交详情页按钮）。

默认联调模式（与后端决策一致）：

- `Stub + worker`：`AI_FEEDBACK_PROVIDER=stub` + `AI_FEEDBACK_WORKER_ENABLED=true`。
- `process-once` 仅用于 debug/ops，不是默认交付模式。
- 前端已按 `NOT_REQUESTED/PENDING/RUNNING/SUCCEEDED/FAILED/DEAD` 全状态展示。
- `request AI` 按钮的产品语义已收口：仅 `NOT_REQUESTED` 可手工触发；`FAILED` 不再允许手工重发请求，避免误导为“点击即可重置 job”。
- 学生提交详情页自动刷新口径：`PENDING/RUNNING` 按较快节奏轮询，`FAILED` 按较慢节奏轮询，并包含“页面不可见暂停 + 长时间状态不变降频 + 同页防重叠”保护。
- 学生提交详情页按钮状态口径：服务端刷新后的 `initialStatus` 为按钮真相源，本地状态仅作短暂过渡，不长期覆盖父级新状态。
- 学生任务详情页自动刷新口径：由当前页真实状态集合（`latest + submissions[*].aiFeedbackStatus`）驱动；存在 `PENDING/RUNNING` 时快速刷新，仅存在 `FAILED` 时慢速刷新；所有 submission 均非活跃后执行一次最小收尾刷新再停止，并保持页面可见性暂停/恢复与同页防重叠保护。

## 7) 当前阶段判断

当前前端已达到“主链路整体可用 + 任务模板层与班级实例层边界收口 + 模板主链路可维护”的阶段，但尚未进入“最终交付定版”阶段。

已达到：

- Teacher / Student 主链路可用。
- P0 真接口前端收口完成。
- submission detail 稳定读源已落地（双角色详情页）。
- AI 闭环前端产品入口已落地（request + 状态提示 + 帮助页 + submission detail 与 student task detail 状态驱动自动刷新）。
- 任务模板页能力已落地：创建、编辑、基础 rubric 配置、筛选与跨页上下文链路。
- 任务模板课程分类（`courseLabel`）与模板可见性（`visibility`）已接入前端：`courseLabel` 单选可空、`visibility` 两档单选，均用于模板治理，不绑定课程、不限制跨课程复用。
- 模板列表视图已接入 `scope`（`mine/shared/all`），默认 `mine`；`shared` 视图可读共享模板，非作者模板不暴露误导性编辑入口。
- 模板列表默认排序是前端内建行为，不新增 URL 排序参数，也不新增用户可配置排序器。
- 班级任务页职责已收口：仅发布已有 `PUBLISHED` 模板，且模板选择体验已增强。
- 教师模板编辑页已收口为生命周期动作模式：普通保存不再提交 `status`，`DRAFT` 走发布动作、`PUBLISHED` 走归档动作、`ARCHIVED` 保持只读且不再提供恢复入口；同时保留对旧后端错误 detail 的中文兜底收口。

未达到：

- 最终交付态 UI 收敛（仍保留较多 raw JSON `<details>` 调试块）。
- ops/debug 前端专用页面（`/ops/**`）尚未建设。
- 模板治理仍为 MVP（删除/复制/批量等能力未提供）。

仍需优先关注：

- 继续按手工验收清单做主链路回归，重点覆盖“模板状态 -> 班级发布候选”一致性。
- 主链路页面仍有一定工程化痕迹（调试信息较多、主视图信息密度不均）。
- 浏览器级自动化 smoke 尚未建立（当前 `frontend/package.json` 仅有 `dev/build/start/lint` 脚本）。
- 用户资料编辑等非主链路能力尚未前端化（后端 `PATCH /api/users/me` 已可用但前端未提供对应页面/表单）。

## 8) 手工验收入口

- 手工验收文档位置：`docs/handoff/handoff-frontend-manual-checklist.md`。
