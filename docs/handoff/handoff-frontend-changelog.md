# EduForge 前端阶段变更薄记录（Step 8~12 + UAT-FE-01~06）

用途：快速说明关键阶段形成了哪些结论、哪些口径已收口、哪些旧做法禁止回退。

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

## UAT-FE-01

- 【本步解决】班级任务页混合“创建模板 + 发布班级实例”的职责冲突。
- 【新增事实 / 已收口口径】`PublishClassroomTaskForm` 仅提交 `POST /classrooms/:id/tasks`；班级页只负责选择已有模板并发布到班级。
- 【不要回退】不要在班级页恢复 `POST /learning-tasks/tasks` 快速创建分支；不要恢复 `feedbackEnabled` 交互项。
- 【对新会话的意义】模板层与班级实例层边界已明确，后续需求可按分层稳定落地。

## UAT-FE-02

- 【本步解决】任务模板创建入口缺失，教师需在班级页“隐式建模板”的问题。
- 【新增事实 / 已收口口径】新增 `/teacher/tasks` 与 `CreateLearningTaskForm`，支持模板列表 + 创建（`title/description/knowledgeModule/stage/status`）。
- 【不要回退】不要把标题/描述输入重新放回班级发布主流程。
- 【对新会话的意义】教师可先在模板页准备模板，再回班级页发布，链路可解释性更高。

## UAT-FE-03

- 【本步解决】模板层缺少基础 rubric 配置与可见性。
- 【新增事实 / 已收口口径】创建表单支持结构化 rubric 字段（权重 + notes）；列表新增“已配置/未配置”与轻量摘要。
- 【不要回退】不要改为高级 JSON 原始编辑器；班级页不承担 rubric 配置。
- 【对新会话的意义】模板层评分参考有最小可用能力，且兼容旧模板缺失/非标准结构。

## UAT-FE-04

- 【本步解决】模板创建后不可维护的问题。
- 【新增事实 / 已收口口径】新增 `/teacher/tasks/[taskId]/edit` + `EditLearningTaskForm`；接入模板详情与更新，支持 `title/description/knowledgeModule/stage/status/rubric` 编辑。
- 【不要回退】不要把模板编辑能力放回班级页。
- 【对新会话的意义】模板从“可创建”进入“可维护”阶段，状态管理与发布语义可持续。

## UAT-FE-05

- 【本步解决】模板数量增长后查找效率低、跨页认知弱的问题。
- 【新增事实 / 已收口口径】`/teacher/tasks` 增加本地筛选（`status/knowledgeModule/stage`）与重置；补充 `paths.teacher.tasksFromClassroom(...)` 跨页上下文链路。
- 【不要回退】不要将模板筛选能力混入班级发布请求；保持模板页承担筛选。
- 【对新会话的意义】教师可先筛选 `PUBLISHED` 模板再回班级发布，链路更顺畅。

## UAT-FE-06

- 【本步解决】班级发布页“只靠下拉框选模板”信息密度不足的问题。
- 【新增事实 / 已收口口径】`PublishClassroomTaskForm` 增加本地筛选（模块/阶段）、候选列表、已选模板摘要与 rubric 状态提示；无候选模板时给出明确引导到模板页。
- 【不要回退】不要恢复班级页内模板创建/编辑；保持仅发布已有 `PUBLISHED` 模板。
- 【对新会话的意义】教师在真正发布前可更快确认模板是否匹配，误选风险显著降低。

## UAT-FE-07

- 【本步解决】Student 任务详情页信息不完整、偏“提交工作台”的问题。
- 【新增事实 / 已收口口径】`/student/classrooms/[classroomId]/tasks/[classroomTaskId]` 已补齐为“任务详情 + 提交工作台”：在保留提交区、提交记录、AI 状态提示与相关入口的同时，正式展示任务基础信息、任务说明（`task.description`）与评分标准（`task.rubric`）。
- 【不要回退】不要把该页退回为“仅提交入口 + 历史列表”的形态，不要再要求学生通过 raw JSON 才能看到任务说明与评分标准。
- 【对新会话的意义】Student 任务详情页可直接承载“读题 + 了解评分口径 + 提交/查看历史”的完整学习动作，后续优化应围绕该一体化页面继续演进。

## UAT-FE-08

- 【本步解决】rubric 四维中文文案在教师端与学生端分散维护、存在漂移风险的问题。
- 【新增事实 / 已收口口径】前端已收敛统一映射入口 `frontend/lib/ui/rubric.ts`（`RUBRIC_DIMENSION_LABELS` + `getRubricDimensionLabel`）；固定四维中文口径统一为：`functionality=功能完成度权重`、`correctness=正确性权重`、`codeStyle=代码规范权重`、`design=设计/思路权重`；教师创建页、教师编辑页、学生任务详情页共同复用该来源。
- 【不要回退】不要在页面内部继续维护本地 `labelMap`，不要在创建页/编辑页/学生页分别手写四份 rubric 中文文案。
- 【对新会话的意义】rubric 展示口径已有单一事实源，后续文案调整与历史数据兼容可在统一入口集中治理，减少跨页面不一致。

## UAT-FE-09

- 【本步解决】学习轨迹页 `includeAttempts/includeTagDetails` 开关“参数变化可见、主视图不可见”的体验问题，以及“错误变化”语义不清的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` 主表已将列文案明确为“错误数变化（最近 vs 首次）”，单元格直接展示 `+N（增加）/-N（减少）/0（无变化）`；当打开 `includeAttempts/includeTagDetails` 时，主视图会显示行下扩展区（尝试详情、首次标签/最近标签），空数据明确显示“无”或“当前无尝试详情数据”。
- 【不要回退】不要把开关效果再次退回到“只影响 query/raw JSON、主视图无感知”的状态；不要移除错误变化的方向语义文案。
- 【对新会话的意义】教师在主视图即可感知开关生效并读懂错误趋势，无需依赖 raw JSON 才能确认数据变化。

## UAT-FE-10

- 【本步解决】学习轨迹 attempts 扩展区把 `feedbackSummary.totalItems`（AI 摘要条目数）误当“总反馈数”的口径混淆问题。
- 【新增事实 / 已收口口径】学习轨迹页 attempts 中“总反馈”已切换为读取 `attempt.feedbackCount`；`feedbackSummary.totalItems` 仅作为 AI 摘要信息展示，不再用于总反馈计数。
- 【不要回退】不要再使用 `feedbackSummary.totalItems` 渲染“反馈 X”总数文案。
- 【对新会话的意义】当 `feedbackCount` 与 AI 摘要条目数不一致时，前端显示口径与后端契约保持一致。

## UAT-FE-11

- 【本步解决】学生提交表单 language 固定默认 `javascript` 对真实 AI 造成错误先验误导的问题。
- 【新增事实 / 已收口口径】`SubmissionForm` 的 language 默认行为已改为“自动识别（默认）”，未手动指定时提交值为 `auto`；用户仍可手动选择具体语言（Java/JavaScript/TypeScript/Python/C/C++/Other）。
- 【不要回退】不要恢复固定默认 `javascript`，不要把“未选择语言”继续伪装成具体语言值。
- 【对新会话的意义】学生未指定语言时不会再给后端/模型注入高误导默认值，真实 AI 更依赖代码内容判断语言。

## UAT-FE-12

- 【本步解决】学生提交详情页反馈列表表头工程化、枚举值英文直出、`suggestion` 展示不清晰的问题。
- 【新增事实 / 已收口口径】`/student/submissions/[submissionId]` 反馈列表已改为中文表头（来源/类型/严重程度/反馈内容/修改建议/标签/时间）；`source/type/severity` 使用前端中文映射；`message` 与 `suggestion` 分列显示，`suggestion` 为空时显示“暂无”。
- 【不要回退】不要恢复 `source/type/severity/message/tags` 英文字段名表头，不要再把 `suggestion` 隐藏在 raw JSON 或省略展示。
- 【对新会话的意义】学生可直接按“反馈内容 + 修改建议”阅读并行动，减少工程化字段对教学阅读路径的干扰。

## UAT-FE-13

- 【本步解决】学生提交详情页反馈列表中“中文表头 + 英文枚举原值”口径不一致的问题。
- 【新增事实 / 已收口口径】`/student/submissions/[submissionId]` 反馈列表继续使用中文表头（来源/类型/严重程度/反馈内容/修改建议/标签/时间）；`source/type/severity` 单元格恢复为后端英文枚举原样展示（未知值同样原样展示，空值显示占位）；`suggestion` 独立列继续保留。
- 【不要回退】不要把表头回退为英文数据库字段名；不要移除 `suggestion` 独立列。
- 【对新会话的意义】教学阅读层继续保持中文结构化表头，同时与后端枚举值保持一一对应，减少术语映射歧义。

## UAT-FE-14

- 【本步解决】教师反馈表单 `tags` 自由手写与后端标准词表约束不一致的问题。
- 【新增事实 / 已收口口径】`TeacherFeedbackForm` 已移除逗号分隔自由标签输入，改为标准标签多选（前端镜像后端统一词表）；提交 payload 的 `tags` 仅来自预设选项；`message`/`suggestion` 继续自由填写。
- 【错误提示收口】当后端返回 `400/Invalid tag(s), please select from predefined tags` 时，前端显示中文摘要“标签无效，请从预设标签中选择”，并保留 detail 以便调试。
- 【不要回退】不要恢复自由手写标签输入，不要在多个页面重复手写标签词表。

## UAT-FE-15

- 【本步解决】教师课堂复盘页信息表达工程化、讲评阅读路径不清晰的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` 已重排为“课堂结论摘要 -> 行动建议 -> 高频问题概览 -> 典型样例 -> 教学脚本 -> 原始数据（调试）”；筛选标签与 `Top Tags/Top Types/Top Severities` 已中文化；教学脚本主视图展示前 3 条 talking points 并支持展开更多；原始 JSON 保留但默认折叠。
- 【不要回退】不要恢复“原始 JSON 与工程字段并列主展示”的旧视图，不要退回“教学脚本仅展示 `talkingPoints.0`”。
- 【对新会话的意义】课堂讲评准备可先读结论与行动，再快速定位高频问题和可用样例，减少对 raw JSON 的依赖。

## UAT-FE-16

- 【本步解决】review-pack 页顶部缺少关键数字总览、典型样例“有标签但缺可讲评文本”的问题。
- 【新增事实 / 已收口口径】页面顶部新增“课堂总览”指标区（提交覆盖、AI 成功率、逾期情况、样例数量、尝试分布）；指标从 `overview` 现有字段安全提取并在缺字段时显示占位。典型样例当时接入 `examples(tag + samples)` 结构（历史口径，已在 UAT-FE-19 切换为去重样例池）。
- 【不要回退】不要再把 `examples` 直接当平铺对象渲染，不要恢复“反馈摘要主要为暂无占位”的样例展示。
- 【对新会话的意义】教师进入页面即可先看关键课堂指标，再直接拿可读样例做讲评准备，减少对 raw JSON 的依赖。

## UAT-FE-17

- 【本步解决】review-pack 前端仍依赖已删除后端契约（`actionItems/teacherScript/includeTeacherScript`）的问题。
- 【新增事实 / 已收口口径】review-pack 页面已移除“行动建议/教学脚本”区块与对应 query 开关；当前页面主结构聚焦“课堂总览 -> 课堂结论摘要 -> 高频问题概览 -> 典型样例 -> 学生分层 -> 原始数据（调试）”。`ReviewPackResponse` 前端类型与 `toReviewPackResponse` 适配已同步删除 `actionItems`、`teacherScript`，并接入 `studentTiers`。
- 【不要回退】不要在前端继续拼接 `includeTeacherScript`，不要保留 `actionItems/teacherScript` 的伪兼容展示。
- 【对新会话的意义】review-pack 页面叙事从“模板建议/讲稿”回到“证据型复盘”，与后端新契约一致。

## UAT-FE-18

- 【本步解决】review-pack 学生分层仍展示裸 `studentId`，教师阅读成本高的问题。
- 【新增事实 / 已收口口径】`ReviewPackResponse.studentTiers` 前端适配已接入 `studentName/studentNo`；学生分层卡片主展示改为姓名，学号作为次级信息（存在时显示），`studentId` 仅保留内部标识用途不再对教师直出。
- 【展示规则】`good/watch` 继续展示 `attemptsCount/latestErrorCount` 辅助判断；`notSubmitted` 只展示学生身份信息，不伪造尝试次数与错误数。
- 【不要回退】不要恢复在 UI 直接渲染 Mongo ObjectId；姓名缺失时保持“未知学生”兜底。

## UAT-FE-19

- 【本步解决】review-pack 典型样例仍按旧 `tag + samples` 结构渲染，导致新后端去重契约无法被正确消费的问题。
- 【新增事实 / 已收口口径】`ReviewPackResponse.examples` 前端类型与适配已切换为去重样例池结构（`feedbackId/submissionId/attemptNo/severity/type/message/suggestion/source/primaryTag/matchedTags/tags`）；页面样例区改为直接渲染去重列表，不再按标签分组摊平。
- 【展示规则】每条样例展示 `primaryTag` 与“其他命中标签”，并保留 `severity/type/message/suggestion/attemptNo`；`feedbackId/submissionId` 仅做内部标识，不作为教师主可见文本。
- 【不要回退】不要恢复 `examples(tag + samples)` 的旧派生逻辑，不要按 `matchedTags` 再展开成重复卡片。

## UAT-FE-20

- 【本步解决】review-pack 典型样例无法快速进入原始提交核查的问题。
- 【新增事实 / 已收口口径】典型样例卡片新增“查看对应提交”入口，复用现有 `teacher/submissions/[submissionId]` 页面；链接附带 `classroomId/classroomTaskId` 查询参数，保持提交详情页“返回任务提交列表/任务详情”的回跳语义。
- 【展示规则】入口为样例卡片内次级文本链接，不改变样例主体信息层级，不直出 `submissionId/feedbackId` 作为教师主文本。
- 【不要回退】不要新增独立样例详情页，不要改后端契约。

## UAT-FE-21

- 【本步解决】review-pack“课堂结论摘要”与“高频问题概览”重复复述同一组榜单的问题。
- 【新增事实 / 已收口口径】摘要区已改为三类综合结论：提交覆盖与尝试态势、当前主问题方向、学生分层关注点；不再逐项复述 `topTags/topTypes/topSeverities`。
- 【职责分工】“高频问题概览”继续承担标签/类型/严重度详细统计展示，摘要区只保留教师决策向的高层判断。
- 【不要回退】不要把摘要区改回“高频榜单小号复读机”。

## 当前阶段一句话结论

前端已达到“Teacher/Student 主链路可用 + 任务模板层与班级实例层边界收口 + 教师模板主链路可维护”的工程验收阶段，但尚未进入最终交付定版阶段。

## 新会话续接提醒（不要回退的口径）

- Members 与 classroomTask submissions 继续以真接口为主，不回退 workaround。
- Submission detail 继续以稳定读源为主，不回退 query 主数据。
- AI 默认联调继续使用 `Stub + worker`，不把 `process-once` 当主模式。
- 课程视角与 Teacher 起步入口已是主链路组成部分，不回退为“仅班级入口”。
- 任务模板层（`/teacher/tasks`）与班级实例层（`/teacher/classrooms/[classroomId]/tasks`）继续分层，禁止回退为混合流。
