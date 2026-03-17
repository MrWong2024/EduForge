# EduForge 前端阶段变更薄记录（Step 8~12）

用途：快速说明本会话后半段（Step 8~12）形成了哪些阶段结论、哪些口径已收口、哪些旧做法禁止回退。

## 阅读建议

- 本文是“阶段变化索引”，不是权威现状快照。
- 当前权威现状仍以 `docs/handoff/handoff-frontend-snapshot.md` + `frontend/**` 代码为准。
- 使用方式：先看本文定位“变更点”，再到 snapshot/route-map/component-map 查现状细节。

## Step 8

- 【本步解决】Teacher 成员页与课堂任务提交管理页摆脱旧 workaround，切回真接口。
- 【新增事实 / 已收口口径】成员页读 `GET /classrooms/:id/students`；课堂任务提交管理页读 `GET /classrooms/:classroomId/tasks/:classroomTaskId/submissions`。
- 【不要回退】不要再用 `process-assessment` 或 `taskId` 过滤兜底替代上述两条真接口。
- 【对新会话的意义】后续排障与增强应直接围绕这两条主读源做，不再维护双轨数据来源。

## Step 9-A

- 【本步解决】submission detail 缺少稳定主读源的问题。
- 【新增事实 / 已收口口径】后端稳定读源为 `GET /learning-tasks/submissions/:id`；detail 可返回 `content.codeText`；提交列表口径继续不返回 `content.codeText`。
- 【不要回退】不要把 submissions 列表接口扩展成 detail 读源，不要在列表层暴露代码文本。
- 【对新会话的意义】detail/list 边界清晰，后续改动可避免“列表越来越重”的回归。

## Step 9-B

- 【本步解决】Teacher/Student submission detail 主数据来源混杂的问题。
- 【新增事实 / 已收口口径】Teacher 与 Student submission detail 主体数据已改接稳定读源 `GET /learning-tasks/submissions/:id`；query 仅承担导航上下文与极少量 fallback。
- 【不要回退】不要再把 query 透传当 submission detail 主数据源。
- 【对新会话的意义】detail 页改造与 bugfix 可优先落在稳定读源解析与详情页本身。

## Step 10-A

- 【本步解决】AI 联调模式不稳定、验收口径不统一的问题。
- 【新增事实 / 已收口口径】AI 默认联调/验收模式固定为 `Stub + worker`；`request` 负责入队，worker 负责消费到 `SUCCEEDED`。
- 【不要回退】不要把 `process-once` 当默认交付模式；它仅用于 debug/ops 辅助。
- 【对新会话的意义】联调环境先统一，再做页面验收，减少“接口正常但状态不流转”的误判。

## Step 10-B

- 【本步解决】Teacher 仅班级视角、课程视角缺失的问题。
- 【新增事实 / 已收口口径】课程视角已补齐：`/teacher/courses` + `/teacher/courses/[courseId]/overview`；课程可作为班级创建/管理上游入口。
- 【不要回退】不要把 Teacher 起步链路简化回“仅班级入口”。
- 【对新会话的意义】排期与优化要同时覆盖“课程 -> 班级 -> 任务”链路，而不是只看班级页。

## Step 11

- 【本步解决】Teacher 空系统起步能力不足的问题。
- 【新增事实 / 已收口口径】Teacher 已具备创建课程与创建班级入口（`CreateCourseForm`、`CreateClassroomForm`）并形成起步闭环。
- 【不要回退】不要移除或弱化起步入口，避免新账号首轮无法自助起步。
- 【对新会话的意义】后续优化可聚焦“顺滑度”，而非重新补“有没有入口”。

## Step 12

- 【本步解决】空系统起步引导与工程化展示噪声问题。
- 【新增事实 / 已收口口径】空系统起步引导已补齐；核心页 raw JSON 采用默认折叠；手工验收清单已落地于 `docs/handoff/handoff-frontend-manual-checklist.md`。
- 【不要回退】不要恢复“主视图缺信息、必须先看 raw JSON 才能操作”的旧体验。
- 【对新会话的意义】验收与续接可直接按 manual checklist 执行，不需回忆会话过程。

## 当前阶段一句话结论

前端已达到“主链路整体可用、Teacher 可自助起步”的工程验收阶段，但尚未进入最终交付定版阶段。

## 新会话续接提醒（不要回退的口径）

- Members 与 classroomTask submissions 继续以真接口为主，不回退 workaround。
- Submission detail 继续以稳定读源为主，不回退 query 主数据。
- AI 默认联调继续使用 `Stub + worker`，不把 `process-once` 当主模式。
- 课程视角与 Teacher 起步入口已是主链路组成部分，不回退为“仅班级入口”。
