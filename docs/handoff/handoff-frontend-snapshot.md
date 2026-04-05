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
│  ├─ student/**                   # 加班级/提交/请求AI/处理提示
│  └─ classroomTask/TaskContextHeader
└─ lib/
   ├─ api/{client,browser-client,error-presenter,types-*}
   ├─ auth/{session,role-home}
   ├─ routes/paths.ts
   ├─ ui/{status,format,rubric}
   └─ http/server-cookie.ts
```

## 2) 路由分区与完成度（摘要）

- `/(auth)/login`：已完成登录与 role-home 跳转（`TEACHER -> /teacher/classrooms`, `STUDENT -> /student`）。
- `/teacher/**`：教师起步链路、模板链路、班级发布链路、批阅链路、三件套、周报/过程性评价/快照已接入真接口。
- 教师模板层（已落地）：
  - `/teacher/tasks`：模板列表 + 创建 + 视图切换（默认 `scope=mine`，支持 `mine/shared/all`）+ URL 驱动筛选（`scope/courseLabel/status/knowledgeModule/stage/page`）并展示模板可见性 `visibility(私有/共享)`；列表已切到后端真实查询与标准分页（固定 `limit=20`，`page` 入 URL，筛选变化自动回到第一页）；默认排序按 scope 收口（`mine=最近更新优先`、`shared=PUBLISHED 优先`、`all=我的模板优先`）
  - `/teacher/tasks/[taskId]/edit`：模板编辑/查看与状态管理（含可选课程分类、模板可见性；非作者共享模板只读）；从模板页进入编辑时携带 `returnTo`（当前完整列表 URL），编辑页顶部/底部返回优先回到该地址，缺失或非法时回退 `/teacher/tasks`
- 教师班级实例层（已收口）：
  - `/teacher/classrooms/[classroomId]/tasks`：选择“当前教师可见且已发布”的模板并发布到班级实例；候选池改为实时调用 `GET classrooms/:id/publishable-task-templates`，筛选条件 `courseLabel/onlyMine/knowledgeModule/stage` 透传后端，后端内置“仅 PUBLISHED + 排除本班已发布模板 + 课程优先排序”，不承担模板创建/编辑。
  - 课堂任务实例列表已展示生命周期状态（`ACTIVE/CLOSED/RECALLED` -> `进行中/已关闭/已撤回`）；`ACTIVE` 任务可执行“关闭任务”（`PATCH classrooms/:classroomId/tasks/:classroomTaskId/status`，`status=CLOSED`），`CLOSED` 任务可执行“恢复提交”（同接口，`status=ACTIVE`），且 `ACTIVE/CLOSED` 任务可执行“编辑设置”（`PATCH classrooms/:classroomId/tasks/:classroomTaskId`，更新 `dueAt/allowLate/maxAttempts`）；`RECALLED` 仅展示状态，不提供恢复提交或编辑设置入口。恢复提交仅恢复状态，不自动修改 `dueAt/allowLate/maxAttempts`。
  - 候选池首屏仍由 server 侧请求 `page=1&limit=50`；发布表单支持“加载更多”按当前筛选追加后续页（非完整分页器）；筛选条件变化时重置回第一页并清空历史追加结果。
  - 发布页“课程分类”下拉已改为复用统一标准课程分类列表（`lib/learning-tasks/course-labels.ts`），不再从当前已加载候选集合倒推选项。
- `/student/**`：学习看板、加入班级、任务详情、提交、submission detail、请求 AI 已接入真接口。
- `/_demo/**`：独立 demo 沙箱，使用 `app/api/_demo/**` 内存数据，不参与主链路交付，不应作为正式 Teacher/Student 主链路实现参考。

## 3) 关键公共机制（已落地）

- 统一路由常量：`lib/routes/paths.ts`（含 `paths.teacher.tasks`、`taskEdit`、`tasksFromClassroom`）。
- 模板治理口径单一来源：
  - `lib/learning-tasks/course-labels.ts`：`courseLabel` 候选项与“未分类”显示口径（课程模块与任务模板模块复用同一来源）。
  - `lib/learning-tasks/template-visibility-scope.ts`：`visibility(PRIVATE/SHARED)` 与 `scope(mine/shared/all)` 值域、显示文案、normalize。
  - `lib/learning-tasks/template-list-sorting.ts`：模板列表默认排序策略（前端默认行为，非用户可配置项）。
- 统一状态文案：`lib/ui/status.ts`（含 `NOT_REQUESTED` 正常语义）。
- 统一 rubric 四维中文映射：`lib/ui/rubric.ts`（`functionality/correctness/codeStyle/design` 与中文文案的单一事实源，供 Teacher/Student 共同复用）。
- 统一错误展开：`lib/api/error-presenter.ts` + `components/blocks/ErrorState.tsx`。
- 空态组件：`components/blocks/EmptyState.tsx`。
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
2. `CreateClassroomForm` -> `POST classrooms`
3. `/teacher/tasks` 进行模板创建/筛选，必要时进入 `/teacher/tasks/[taskId]/edit` 维护模板状态与 rubric
   - 模板层已接入 `courseLabel`（课程分类）与 `visibility`（私有/共享）字段：创建/编辑可维护，列表可筛选并展示；`courseLabel` 与 `visibility` 都是模板治理字段，不绑定课程。
   - 模板列表默认 `scope=mine`，并支持显式切换 `mine/shared/all`；共享只影响读可见性，不改变作者权限边界。
   - 模板筛选已统一走后端真实查询：`scope/courseLabel/status/knowledgeModule/stage` 透传 `GET learning-tasks/tasks`；页面标准分页使用 `page` query（固定 `limit=20`），筛选变化自动重置到第一页。
   - 模板列表默认排序已前端收口：`mine` 按最近更新时间降序（同时间按创建时间）；`shared` 先 `PUBLISHED` 再按最近更新时间；`all` 先“我的模板”再“他人共享模板”。
4. `/teacher/classrooms/[classroomId]/tasks` 选择当前可见且已发布模板（我的 + 可见共享）并设置 `dueAt/allowLate/maxAttempts` 后发布（`POST classrooms/:id/tasks`）；候选池由 `GET classrooms/:id/publishable-task-templates` 按 query 实时检索，`courseLabel/onlyMine/knowledgeModule/stage` 均为后端真实查询条件，且后端已内置排除本班已发布模板
   - 首次仅加载第一页（`page=1&limit=50`），当 `total` 大于当前已加载数量时可在表单内“加载更多”并追加候选；筛选条件变化后回到第一页结果。
   - `courseLabel` 下拉使用标准分类全集，选择后通过 URL query 触发后端重查；加载更多不会改变下拉选项集合。
   - 班级实例列表中支持行内“编辑设置”，用于更新已发布课堂任务的实例级参数（`dueAt/allowLate/maxAttempts`）；该能力与模板编辑解耦，仅在 `ACTIVE/CLOSED` 状态开放。
5. 进入 `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/*` 和提交管理页

Teacher 课程视角（可用）：
- `/teacher/courses` 已支持课程列表与创建课程，`courseLabel`（课程分类）可选录入并在列表展示。
- `/teacher/courses/[courseId]/overview` 已接入课程总览，并展示课程分类。
- `/teacher/courses/[courseId]/edit` 已支持课程基础信息编辑（`code/name/term/courseLabel`）；`courseLabel` 可修改也可清空。
- 课程视角可作为进入班级创建/班级管理的上游入口（跳转到 `/teacher/classrooms` 或带 `courseId` 的班级页）。

Teacher 班级看板链路（可用）：
1. `/teacher/classrooms/[classroomId]/dashboard` 已保持真接口读取（`GET /api/classrooms/:id` + `GET /api/classrooms/:id/dashboard`），不新增请求参数与后端契约。
2. 顶部概览已收口为 `summary.studentsCount`、`summary.publishedTasksCount`、`summary.lateStudentsTotal` 三个核心指标，不再使用与班级看板语义弱相关的占位值展示。
3. 任务明细表已补齐“提交进度（distinctStudentsSubmitted / studentsCount）”、“AI 处理概况（成功/失败/排队/处理中/终止/未请求）”与 `topTags` 前 2~3 项摘要。
4. 每行任务已新增三类快捷入口：`提交记录`（submissions）、`课堂复盘`（review-pack）、`AI 指标`（ai-metrics），用于从看板直接下钻。

Student 学习链路（可用）：
1. `/student/classrooms/join` -> `POST classrooms/join`
2. `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` -> `GET .../my-task-detail`（页面已是“任务详情 + 提交工作台”，正式展示任务基础信息、任务说明 `task.description`、评分标准 `task.rubric`，并保留提交与历史记录）
3. `SubmissionForm` -> `POST .../submissions`（language 默认“自动识别”，未手动指定时提交 `auto`，不再默认 `javascript`）
4. `/student/submissions/[submissionId]` -> 稳定读源 + feedback 列表 + request AI
   - 反馈主列表已中文化：表头使用“来源/类型/严重程度/反馈内容/修改建议/标签/时间”。
   - `source/type/severity` 在列表单元格按后端原值直出（英文枚举不翻译）；`message` 与 `suggestion` 分列展示（`suggestion` 为空时显示“暂无”）。

Teacher 批阅链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions`
2. `/teacher/submissions/[submissionId]`（稳定读源）
3. `TeacherFeedbackForm` -> `POST learning-tasks/submissions/:id/feedback`
   - `tags` 已改为标准标签多选（镜像后端统一词表），移除自由手写输入。
   - `message` / `suggestion` 保持自由文本输入；未选择标签时沿用后端兜底口径。
   - 若后端返回 `400/Invalid tag(s), please select from predefined tags`，前端显示中文摘要“标签无效，请从预设标签中选择”。 

Teacher 学习轨迹链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory`
2. 主表保留摘要列（学生/尝试次数/最近尝试时间/最近 AI 状态/错误数变化）。
3. `错误数变化（最近 vs 首次）` 已在单元格明确展示 `增加/减少/无变化` 语义。
4. `includeAttempts/includeTagDetails` 已在主视图提供可见扩展区（尝试详情、首次标签/最近标签），不再仅体现在请求参数与 raw JSON。
5. attempts 扩展区“总反馈”已消费 `attempt.feedbackCount`（全来源总反馈数）；`feedbackSummary.totalItems` 仅作为 AI 摘要信息展示，不再充当总反馈数。

Teacher AI 指标链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` 保持真接口与 query 协议（`window/includeTags`）不变。
2. 筛选区窗口文案已统一为“统计窗口：1h（近1小时）/24h（近24小时）/7d（近7天）”风格，减少工程化简写歧义。
3. `summary.avgAttempts` 前端文案已收口为“AI 平均重试次数”，避免被误读为学生提交尝试次数。
4. `summary.avgLatencyMs` 在当前为 `null` 时不再作为主 KPI 卡片展示，改为“平均耗时指标当前暂未采集”说明文案。

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

## 7) 当前阶段判断

当前前端已达到“主链路整体可用 + 任务模板层与班级实例层边界收口 + 模板主链路可维护”的阶段，但尚未进入“最终交付定版”阶段。

已达到：

- Teacher / Student 主链路可用。
- P0 真接口前端收口完成。
- submission detail 稳定读源已落地（双角色详情页）。
- AI 闭环前端产品入口已落地（request + 状态提示 + 帮助页）。
- 任务模板页能力已落地：创建、编辑、基础 rubric 配置、筛选与跨页上下文链路。
- 任务模板课程分类（`courseLabel`）与模板可见性（`visibility`）已接入前端：`courseLabel` 单选可空、`visibility` 两档单选，均用于模板治理，不绑定课程、不限制跨课程复用。
- 模板列表视图已接入 `scope`（`mine/shared/all`），默认 `mine`；`shared` 视图可读共享模板，非作者模板不暴露误导性编辑入口。
- 模板列表默认排序是前端内建行为，不新增 URL 排序参数，也不新增用户可配置排序器。
- 班级任务页职责已收口：仅发布已有 `PUBLISHED` 模板，且模板选择体验已增强。

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
