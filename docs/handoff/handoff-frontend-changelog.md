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

## UAT-FE-22

- 【本步解决】review-pack 筛选文案语义不清、尝试分布主值误导、学生分层列表过长的问题。
- 【新增事实 / 已收口口径】筛选区 `topK` 文案改为“问题榜单条数”，`examplesPerTag` 文案改为“每标签候选样例数”；尝试分布卡片改为“四档结构（0/1/2/3+）”主展示，不再以 `0次` 单值占主位。
- 【交互收口】学生分层改为每组默认展示前 6 条，超出时提供分组独立的“展开全部/收起”；分组标题增加总人数显示（如“稳定完成（12）”）。
- 【不要回退】不要恢复“展示条数”旧文案，不要恢复 `slice(0, 8)` 固定截断。

## UAT-FE-23

- 【本步解决】review-pack“尝试分布”仍残留 `value/detail` 叙事、信息密度偏低的问题。
- 【新增事实 / 已收口口径】尝试分布已改为方案 C：`0次/1次/2次/3+次` 四档横向胶囊并列展示，每档直接显示人数；不再显示“单一大号主值 + 第二行机械复述”。
- 【范围控制】仅对“尝试分布”这张 overview 卡片做局部展示特例，其他 overview 卡片继续使用原有主值卡片样式。
- 【不要回退】不要把尝试分布恢复为单值 KPI 卡片。

## UAT-FE-24

- 【本步解决】review-pack“尝试分布”胶囊形态比较感不足、主档识别效率不高的问题。
- 【新增事实 / 已收口口径】尝试分布已改为“左标签 + 左对齐短条 + 右人数”的四档小条形分布：`0次/1次/2次/3+次` 同时可见，条长按“当前档位人数 / 四档最大人数”归一化计算。
- 【细节口径】即使人数为 `0` 或缺失，也保留底轨与极短前景条，避免视觉断层；不再出现旧的主值卡片与复述文本。
- 【不要回退】不要把尝试分布改回胶囊堆叠或单值 KPI 卡片。

## UAT-FE-25

- 【本步解决】AI 指标页 `avgAttempts` 语义歧义、`avgLatencyMs=null` 强 KPI 误导，以及窗口筛选文案过于简写的问题。
- 【新增事实 / 已收口口径】`avgAttempts` 文案已改为“AI 平均重试次数”；`avgLatencyMs` 为 `null` 时不再渲染主 KPI 卡片，改为“平均耗时指标当前暂未采集”说明。
- 【文案统一】窗口筛选区已统一为“统计窗口：1h（近1小时）/24h（近24小时）/7d（近7天）”风格，与课堂复盘页口径更一致。
- 【不要回退】不要把 `avgAttempts` 写回“平均尝试次数”泛化表达，不要再以 `—` 形式强展示空 latency KPI。

## UAT-FE-26

- 【本步解决】班级看板顶部指标语义不直观、任务行信息密度不足（缺提交进度/AI 概况/高频标签/下钻入口）的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/dashboard` 顶部概览已收口为 `summary.studentsCount`、`summary.publishedTasksCount`、`summary.lateStudentsTotal`；任务表已新增提交进度（`distinctStudentsSubmitted / studentsCount`）与任务级 AI 概况（成功/失败/排队/处理中/终止/未请求），并展示 `topTags` 前 2~3 项。
- 【交互收口】每行任务已新增“提交记录 / 课堂复盘 / AI 指标”快捷入口，分别跳转到 submissions、review-pack、ai-metrics 页面；保持仅使用现有路由与接口，不新增后端契约。
- 【不要回退】不要恢复“任务级仅单一 AI 状态”的旧展示，不要移除任务行的三类下钻入口，不要把顶部概览改回无关或占位指标。

## UAT-FE-27

- 【本步解决】任务模板页缺少课程分类治理字段前端接入，导致创建/编辑/筛选/展示口径不一致的问题。
- 【新增事实 / 已收口口径】`/teacher/tasks` 与 `/teacher/tasks/[taskId]/edit` 已接入 `courseLabel`（课程分类）单选可空字段：创建与编辑可维护，列表项可展示，列表筛选支持 `courseLabel` 并通过 URL query 透传到 `GET learning-tasks/tasks`。
- 【语义收口】前端口径明确为“模板治理字段”：单选、可空、非外键、非课程绑定，不参与发布约束，不限制跨课程复用。
- 【实现约束】前端新增单一来源 `frontend/lib/learning-tasks/course-labels.ts` 维护候选项与“未分类”口径；表单/筛选/列表展示共同复用，避免多处硬编码漂移。
- 【不要回退】不要把 `courseLabel` 改成多选或自由输入，不要把其文案改为“所属课程/绑定课程”，不要在发布到班级流程增加课程一致性限制。

## UAT-FE-28

- 【本步解决】任务模板页未接入 `visibility/scope`，教师无法显式区分“我的模板/共享池/全部模板”，且共享模板操作边界不清晰的问题。
- 【新增事实 / 已收口口径】`/teacher/tasks` 默认以 `scope=mine` 拉取模板，并新增 `mine/shared/all` 视图切换（URL query 同步）；列表新增 `visibility`（私有/共享）展示，且与 `courseLabel` 可叠加使用。
- 【创建/编辑接入】`CreateLearningTaskForm` 与 `EditLearningTaskForm` 已接入 `visibility` 单选（`PRIVATE/SHARED`）；创建默认 `PRIVATE`；编辑可在私有/共享间切换并提交。
- 【权限边界前端收口】非作者共享模板在列表操作列不再暴露“编辑”语义入口，统一为“查看”；进入 `/teacher/tasks/[taskId]/edit` 时以只读模式展示，避免误导性可写交互。
- 【单一来源】前端新增 `frontend/lib/learning-tasks/template-visibility-scope.ts` 作为 `visibility/scope` 值域、显示文案与 normalize 的单一来源。
- 【不要回退】不要恢复“默认公共池”列表行为，不要在非作者共享模板上展示可误导的编辑/发布/删除入口，不要把 `visibility` 与课程绑定语义混用。

## UAT-FE-29

- 【本步解决】任务模板三视图默认排序不稳定，首屏经常不是“最值得先看”的模板的问题。
- 【新增事实 / 已收口口径】模板列表默认排序已按 `scope` 前端收口：`mine` 视图按最近更新时间降序（同时间按创建时间）；`shared` 视图先 `PUBLISHED` 再按最近更新时间；`all` 视图先“我的模板”再“他人共享模板”（他人共享内仍优先 `PUBLISHED`）。
- 【实现边界】排序发生在“当前视图 + 当前筛选结果”之后、渲染之前；未新增排序 query 参数，也未新增用户可配置排序器。
- 【单一来源】前端新增 `frontend/lib/learning-tasks/template-list-sorting.ts`，集中维护三视图 compare 逻辑，避免 JSX 内散落排序分支。
- 【不要回退】不要把默认排序退回后端原始顺序，不要把 `shared/all` 视图的排序改成与产品语义无关的随机或作者优先策略。

## UAT-FE-30

- 【本步解决】班级任务发布页候选模板请求依赖默认 `scope=mine`，导致共享模板无法在发布页复用的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks` 拉取候选模板时已显式使用 `scope=all + status=PUBLISHED`（保留 `page=1&limit=50`），候选池覆盖“我的已发布模板 + 我可见的共享已发布模板”。
- 【文案同步】发布页说明已改为“当前可见且已发布模板（含共享模板）”，避免继续暗示仅可选择自己的模板。
- 【边界保持】仅调整候选池口径与提示文案；不新增模板池切换器，不改变模板作者编辑/发布权限边界，不改后端契约。

## UAT-FE-31

- 【本步解决】班级任务发布页候选池与当前班级上下文重复、细筛选维度不足的问题。
- 【新增事实 / 已收口口径】`PublishClassroomTaskForm` 以 `scope=all + status=PUBLISHED` 为基础池，前端默认排除“当前班级已发布过”的模板（依据当前班级实例中的 `taskId` 去重）；不影响下方班级任务实例列表。
- 【轻治理筛选】发布页新增本地轻筛选：`课程分类` 与 `仅看我的模板`，并与既有 `知识模块/阶段` 叠加生效；候选模板下拉与候选卡片列表共用同一过滤结果，避免口径分裂。
- 【空态收口】已区分三类空态：无可见 `PUBLISHED` 模板、可见模板均已在本班发布、当前筛选条件下无匹配。
- 【边界保持】未新增 scope 切换器、未新增排序器、未改后端契约与作者权限边界。

## UAT-FE-32

- 【本步解决】班级发布页仍依赖“固定样本 + 前端核心过滤”，导致筛选命中不稳定的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks` 候选池已切换为 `GET classrooms/:id/publishable-task-templates`；不再以 `GET learning-tasks/tasks?scope=all&status=PUBLISHED&page=1&limit=50` 作为发布主候选来源。
- 【查询语义收口】`courseLabel/onlyMine/knowledgeModule/stage` 已改为后端真实查询条件（URL query -> server fetch）；前端不再承担“排除本班已发布模板”的核心去重逻辑。
- 【交互保持】筛选控件与发布主流程保留原有轻量形态；切换筛选继续使用 `router.replace(..., { scroll: false })`，避免页面突兀回顶。
- 【边界保持】未改后端契约、未改班级任务实例列表请求、未新增复杂视图切换器、未放宽模板作者权限边界。

## UAT-FE-33

- 【本步解决】课程模块 `courseLabel` 后端字段已存在但前端未完整接入，出现“可存不可见/不可输”的半接入问题。
- 【新增事实 / 已收口口径】`/teacher/courses` 已接入课程分类：`CreateCourseForm` 新增可选 `courseLabel` 单选；课程列表新增课程分类展示（空值统一“未分类”）。
- 【类型映射同步】`types-teacher.ts` 已补课程侧 `courseLabel` 字段：创建请求、创建响应、课程列表/课程总览基础信息解析均已同步。
- 【单一来源复用】课程分类候选项复用 `lib/learning-tasks/course-labels.ts`，与任务模板页保持同一标准值域，不新增第二套硬编码列表。
- 【边界保持】当前未命中现有课程编辑页入口，因此本步未扩展课程编辑页面；未改 backend 契约、未改任务模板页与班级发布页。

## UAT-FE-34

- 【本步解决】课程分类在创建后无法维护的问题（“创建可填、后续不可改”半接入）。
- 【新增事实 / 已收口口径】新增课程编辑页 `/teacher/courses/[courseId]/edit`，并新增 `EditCourseForm`；支持编辑 `code/name/term/courseLabel`，`courseLabel` 支持清空。
- 【入口收口】课程列表操作列与课程总览 actions 已补“编辑课程”入口；保存成功后跳转课程总览，便于立即确认更新结果。
- 【类型映射同步】`types-teacher.ts` 已补课程更新相关类型/解析（`UpdateCourseRequest`、`toCourseDetailResponse`、`toCourseUpdateResponse`），并统一 `courseLabel` 解析口径。
- 【边界保持】overview 仍是展示页，不改为编辑页；未改 backend 契约、未改任务模板页与班级发布页、未引入 Course 与 Task 强绑定。

## UAT-FE-35

- 【本步解决】班级发布页候选模板在 `limit=50` 下容易截断，教师无法继续浏览后续候选的问题。
- 【新增事实 / 已收口口径】`PublishClassroomTaskForm` 已支持“加载更多”：首屏仍由 server 提供 `page=1&limit=50`，当后端 `total` 大于当前已加载数量时可请求下一页并追加候选结果。
- 【数据流收口】筛选条件（`courseLabel/onlyMine/knowledgeModule/stage`）变化后仍由 URL query 驱动 server 重查第一页；客户端在接收到新第一页后会重置已追加结果，避免跨筛选条件残留。
- 【边界保持】未引入完整分页器（无页码/无每页条数切换），未改后端分页契约，未改班级任务实例列表与发布主流程。

## UAT-FE-36

- 【本步解决】发布页“课程分类”下拉依赖当前已加载候选倒推，导致首屏/加载更多阶段可选分类不稳定的问题。
- 【新增事实 / 已收口口径】`PublishClassroomTaskForm` 的 `courseLabel` 下拉已改为复用统一标准课程分类列表（`lib/learning-tasks/course-labels.ts`），不再依据当前已加载候选集合动态生成。
- 【查询语义保持】用户选择课程分类后，仍通过 URL query 触发后端 `publishable-task-templates` 重新检索第一页；“加载更多”仅扩展结果，不补全筛选项。
- 【边界保持】未改后端契约、未改分页协议、未改班级任务实例列表、未新增复杂筛选/分页 UI。

## UAT-FE-37

- 【本步解决】任务模板页进入编辑后，顶部/底部返回入口固定跳裸 `/teacher/tasks`，导致来源 query 上下文丢失的问题。
- 【新增事实 / 已收口口径】`LearningTaskFilters` 的编辑/查看入口已附带 `returnTo`（当前任务模板列表完整 URL，含现有 query）；`/teacher/tasks/[taskId]/edit` 顶部返回与 `EditLearningTaskForm` 底部返回均优先使用该 `returnTo`。
- 【安全回退】`returnTo` 仅接受以 `/teacher/tasks` 开头的站内相对路径；缺失或非法时统一回退 `/teacher/tasks`，避免开放式跳转。
- 【兼容性】当前 `scope/courseLabel/status/knowledgeModule/stage/fromClassroomId` query 可随 `returnTo` 一并保留；未来新增分页类 query（如 `page`）可复用同一机制，无需额外改造。

## UAT-FE-38

- 【本步解决】任务模板页仍以“后端取样本 + 前端本地筛选”运行，`status/knowledgeModule/stage` 不是后端真实查询条件，且列表没有标准分页的问题。
- 【新增事实 / 已收口口径】`/teacher/tasks` 已切到 URL 驱动的后端真实查询：`scope/courseLabel/status/knowledgeModule/stage/page` 全部进入 `GET learning-tasks/tasks`；固定 `limit=20`，标准分页改为上一页/下一页（非加载更多）。
- 【交互收口】切换任一筛选条件时统一重置 `page=1` 并使用 `router.replace(..., { scroll: false })`；分页切换仅改 `page`，保留其他筛选 query。
- 【上下文兼容】编辑入口的 `returnTo` 继续携带当前完整列表 URL，分页场景下可自然保留筛选条件与页码。
- 【不要回退】不要再把 `status/knowledgeModule/stage` 当“前 100 条样本上的本地假过滤”，也不要恢复固定 `page=1&limit=100` 的单页样本模式。

## UAT-FE-39

- 【本步解决】课堂任务页缺少 `ClassroomTask` 生命周期状态展示与状态流操作入口的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks` 的课堂任务实例列表已展示 `ACTIVE/CLOSED/RECALLED`（进行中/已关闭/已撤回）状态，并新增 `ACTIVE -> CLOSED` 前端操作（`PATCH classrooms/:classroomId/tasks/:classroomTaskId/status`）。
- 【边界说明】当前列表响应未提供可靠“有无提交”摘要字段，前端本步未拍脑袋接入“撤回发布”按钮；撤回规则仍以后端契约校验为准。
- 【不要回退】不要把“撤回发布”做成物理删除，不要在非 `ACTIVE` 状态继续暴露状态流操作入口。

## UAT-FE-40

- 【本步解决】课堂任务实例发布后缺少“实例级配置可编辑”入口，导致 `dueAt/allowLate/maxAttempts` 只能发布时设置、无法后续修订的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/tasks` 实例列表管理列已新增“编辑设置”入口（行内展开式表单），调用 `PATCH classrooms/:classroomId/tasks/:classroomTaskId` 更新实例级配置（`dueAt/allowLate/maxAttempts`）。
- 【状态边界】前端仅在 `ACTIVE/CLOSED` 状态显示“编辑设置”，`RECALLED` 不显示入口；配置编辑与状态流操作分离，状态仍由 `PATCH .../status` 处理。
- 【边界保持】未改后端契约、未改发布表单主流程、未接“重新打开任务”与“撤回发布”前端动作。

## UAT-FE-41

- 【本步解决】课堂任务被关闭后，教师端缺少“恢复提交”操作，误点关闭后只能停留在 `CLOSED` 的问题。
- 【新增事实 / 已收口口径】`ClassroomTaskLifecycleActions` 已补齐 `CLOSED -> ACTIVE` 前端动作：`CLOSED` 状态显示“恢复提交”，调用 `PATCH classrooms/:classroomId/tasks/:classroomTaskId/status` 且请求体为 `status=ACTIVE`；成功后沿用 `router.refresh()` 刷新列表状态。
- 【语义收口】“恢复提交”仅恢复状态，不自动修改 `dueAt/allowLate/maxAttempts`；`ACTIVE` 仍显示“关闭任务”，`RECALLED` 仍不提供恢复入口。
- 【边界保持】未改后端契约、未改实例级配置编辑能力、未新增“撤回发布”前端按钮。

## UAT-FE-42

- 【本步解决】班级模块缺少前端“编辑班级”入口，导致后端 `PATCH classrooms/:id` 能力无法在教师端使用的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms` 操作列已新增“编辑班级”入口，新增 `/teacher/classrooms/[classroomId]/edit` 与 `EditClassroomForm`；编辑页加载 `GET classrooms/:id`，提交调用 `PATCH classrooms/:id`。
- 【字段与边界】当前严格按后端 `UpdateClassroomDto` 收口，仅支持更新班级名称 `name`；`courseId/status/joinCode` 仅做只读展示；不新增删除、归档前端动作。
- 【错误处理】后端拒绝更新（含 `Archived classrooms cannot be updated`）时，前端显示清晰中文摘要并保留后端 detail，不做吞错处理。

## UAT-FE-43

- 【本步解决】统计窗口前端展示策略仍沿用全站统一 `24h/7d/30d`，与阶段一后端契约（支持 `all` 且默认 `all`）不一致的问题。
- 【新增事实 / 已收口口径】班级级页面 `weekly-report/process-assessment` 主展示窗口已切到 `7d/30d/all`，默认 `all`；单任务页面 `learning-trajectory/review-pack` 主展示窗口已切到 `all/7d`，默认 `all`。
- 【旧链接兼容】班级级页面继续兼容 URL `window=24h`，单任务页面继续兼容 URL `window=24h/30d`；兼容值仍会透传给后端并正常渲染数据，但不再出现在主 tabs 中。
- 【联动收口】`process-assessment.csv` 下载继续沿用当前窗口参数；页面内排序/分页/筛选链接继续透传当前 `window`。
- 【明确不变】`ai-metrics` 窗口集合与默认值保持原样（`1h/24h/7d`），本步未引入 `all`。

## UAT-FE-44

- 【本步解决】班级列表缺少“归档/恢复/删除”前端接入，且无法按进行中/已归档区分浏览的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms` 已接入状态视图切换（`进行中/已归档/全部`，默认进行中），并通过 `statusView` query 保持视图状态；列表请求在进行中/已归档视图下透传后端 `status=ACTIVE/ARCHIVED`。
- 【生命周期动作收口】新增 `ClassroomLifecycleActions`，统一承载：
  - 归档：`PATCH classrooms/:id` with `status=ARCHIVED`
  - 恢复：`PATCH classrooms/:id` with `status=ACTIVE`
  - 删除（次级操作）：`DELETE classrooms/:id`
- 【错误处理收口】删除命中 `409 + CLASSROOM_NOT_EMPTY` 时，前端明确提示“该班级已有成员或任务记录，不能删除，只能归档”，不再只显示泛化失败文案。
- 【交互收口】动作成功后统一 `router.refresh()`，并保留当前 `statusView/courseId/page/limit` query，不打乱教师当前筛选视图。
- 【不要回退】不要把删除提升为主操作按钮，不要在删除失败时回退为模糊“操作失败”提示。

## UAT-FE-45

- 【本步解决】班级列表生命周期操作平铺展示导致操作列噪声偏高的问题。
- 【新增事实 / 已收口口径】`ClassroomLifecycleActions` 已从显性按钮改为“更多”次级菜单：`ACTIVE` 班级显示“归档/删除”，`ARCHIVED` 班级显示“恢复/删除”。
- 【语义保持】归档/恢复/删除调用契约不变（仍为 `PATCH status` 与 `DELETE`）；删除保留二次确认，且 `409 + CLASSROOM_NOT_EMPTY` 继续显示明确中文提示“该班级已有成员或任务记录，不能删除，只能归档”。
- 【交互保持】操作成功后仍统一 `router.refresh()`，并保持当前 `statusView/courseId/page/limit` query。
- 【边界保持】仅前端展示层收口，不涉及 backend 契约、数据结构或新增依赖。

## UAT-FE-46

- 【本步解决】班级列表空态区域重复出现“创建班级”入口，且已归档视图空态动作语义不顺的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms` 页面主创建入口继续固定为 `CreateClassroomForm`；空态动作按 `statusView` 收口：
  - `active` 空态：不额外显示“创建班级”动作。
  - `archived` 空态：移除“创建班级”，仅保留“查看进行中班级”动作（复用现有 query 构造逻辑）。
  - `all` 空态：不额外显示“创建班级”动作。
- 【语义保持】班级生命周期操作（归档/恢复/删除）、列表筛选、`statusView` query、刷新行为均保持不变。
- 【边界保持】仅前端展示层优化，不涉及 backend 契约变更与依赖变更。

## UAT-FE-47

- 【本步解决】课程列表缺少“归档/恢复/删除”前端接入，且空态存在重复“创建课程”入口的问题。
- 【新增事实 / 已收口口径】`/teacher/courses` 已接入状态视图切换（`进行中/已归档/全部`，默认进行中），并通过 `statusView` query 保持视图状态；列表请求在进行中/已归档视图下透传后端 `status=ACTIVE/ARCHIVED`。
- 【课程生命周期动作】新增 `CourseLifecycleActions`，统一收口到“更多”次级菜单：
  - 归档：`PATCH courses/:id` with `status=ARCHIVED`
  - 恢复：`PATCH courses/:id` with `status=ACTIVE`
  - 删除（次级危险操作）：`DELETE courses/:id`
- 【错误处理收口】删除命中 `409 + COURSE_NOT_EMPTY` 时，前端明确提示“该课程下已有班级记录，不能删除，只能归档”，不再只显示泛化失败文案。
- 【空态去重】页面主创建入口继续固定为 `CreateCourseForm`；空态动作按 `statusView` 收口：`archived` 空态仅“查看进行中课程”，`active/all` 空态不再额外展示“创建课程”。
- 【交互保持】操作成功后统一 `router.refresh()`，并保持当前 `statusView/page/limit` query，不打乱教师当前视图。
- 【边界保持】仅前端展示层与交互接入，不涉及 backend 契约变更与依赖变更。

## UAT-FE-48

- 【本步解决】班级/课程列表“更多”菜单在表格滚动容器内展开时会撑出滚动条的问题。
- 【新增事实 / 已收口口径】新增轻量共享浮层组件 `FloatingMoreMenu`（`Portal + fixed`），生命周期菜单渲染到 `document.body`，脱离列表滚动容器。
- 【定位与关闭策略】菜单默认向下展开；下方空间不足时自动上翻；左右超出视口时做边界钳制；保留外部点击关闭、`Esc` 关闭；滚动/resize 时自动关闭，避免定位漂移。
- 【语义保持】`ClassroomLifecycleActions` 与 `CourseLifecycleActions` 的菜单项语义、确认文案、后端调用、`router.refresh()`、`CLASSROOM_NOT_EMPTY/COURSE_NOT_EMPTY` 定制错误提示全部保持不变。
- 【边界保持】仅前端展示层浮层化改造，不涉及 backend 契约与依赖变更。

## UAT-FE-49

- 【本步解决】课程总览页顶部技术态参数裸露（`window/sort/order/page`）与“总览感不足”的问题。
- 【新增事实 / 已收口口径】`/teacher/courses/[courseId]/overview` 页面结构已收口为“筛选区 -> 课程摘要 -> 班级明细 -> 分页”，不再直接展示技术参数回显文本。
- 【筛选表达优化】窗口与排序仍沿用原 query 契约，但改为中文标签按钮组（统计窗口、明细排序、排序方向），并保留原有切换与分页能力。
- 【摘要补强】在不新增后端字段前提下，基于现有 overview `items/total` 前端聚合课程级轻量摘要：班级总数、当前页学生总数、当前页有提交班级数、当前页 AI 待处理总量、当前页 AI 失败总量。
- 【边界保持】仅前端表达层收口，不涉及 backend 接口、字段或契约变更。

## UAT-FE-50

- 【本步解决】课程总览页筛选区风格与学习轨迹/课堂复盘页不一致、主展示窗口策略未收口、摘要项偏“运维态”的问题。
- 【筛选风格对齐】课程总览页筛选区改为与学习轨迹/课堂复盘相近的轻量链接组表达：`统计窗口 / 明细排序 / 排序方向` 三组并列，弱化“控制台感”。
- 【窗口策略收口】前端主展示窗口改为 `all/7d`，默认 `all`；旧值 URL（`1h/24h/7d`）继续兼容请求与展示，且在筛选区以“当前：xxx（旧链接兼容）”轻量提示。
- 【摘要瘦身与口径校正】课程摘要从“当前页运维总量”转为“课程意义优先”：班级总数、当前页班级数、当前页有提交班级数、当前页平均提交率、当前页平均 AI 成功率；明确“除班级总数外均为当前页聚合”，避免误导为全课程总量。
- 【边界保持】仅前端表达层二次收口，不改 backend 契约、不新增接口字段、不新增依赖。

## UAT-FE-51

- 【本步解决】课程总览页比率字段长小数裸露、排序方向控件存在感过高、缺少统一调试入口的问题。
- 【新增事实 / 已收口口径】`/teacher/courses/[courseId]/overview` 的比率类字段已统一为百分比展示：摘要（当前页平均提交率、当前页平均 AI 成功率）与表格（提交率、AI 成功率）共用同一格式化策略（最多 1 位小数，自动去除 `.0`）。
- 【筛选区弱化】排序方向不再作为独立高权重分组，改为附着在“明细排序”旁的轻量切换入口；`order` query 语义与透传逻辑保持不变。
- 【调试入口补齐】页面末尾新增低权重折叠调试块“查看原始 JSON”，样式对齐班级看板/三件套既有 `details + pre` 调试区；内容直接复用当前 overview 响应 `viewModel.data.raw`，未新增任何后端接口。
- 【边界保持】仅前端展示层三次收口，不涉及 backend 契约，不新增依赖。

## UAT-FE-52

- 【本步解决】课程总览页筛选区与 learning-trajectory 风格仍有轻微偏差（`排序方向` 使用附着式按钮，不是独立标签组选项）的问题。
- 【新增事实 / 已收口口径】`/teacher/courses/[courseId]/overview` 筛选区已改为与学习轨迹同家族结构：`统计窗口 / 明细排序 / 顺序` 三个独立标签组，其中 `顺序` 恢复为 `升序/降序` 组选项。
- 【行为保持】窗口主展示仍为 `all/7d`（默认 `all`），旧链接兼容提示仍保留；摘要瘦身、百分比展示、分页导航与底部原始 JSON 调试入口均保持不变。
- 【边界保持】纯前端表达层收口，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-53

- 【本步解决】课程总览页筛选区“当前窗口”提示仅在旧值兼容场景才显示，导致与学习轨迹/课堂复盘筛选语言仍有细微不一致的问题。
- 【新增事实 / 已收口口径】`/teacher/courses/[courseId]/overview` 筛选区固定展示“当前：xxx”；命中旧窗口值（`1h/24h`）时在同位置追加“（旧链接兼容）”标记。
- 【行为保持】`all/7d` 主窗口、默认 `all`、旧值兼容请求、摘要区口径、百分比展示、分页导航与底部原始 JSON 调试入口均保持不变。
- 【边界保持】纯前端表达层微调，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-54

- 【本步解决】课程总览页 `顺序` 仍为“两个并列选项”，与 learning-trajectory 当前单切换写法不一致的问题。
- 【新增事实 / 已收口口径】`/teacher/courses/[courseId]/overview` 的 `顺序` 已改为与 learning-trajectory 一致的单链接翻转：仅展示当前值，点击在 `asc/desc` 间切换并保持 `order` query 语义不变。
- 【口径说明补齐】班级明细区已新增低干扰说明：提交率、AI 成功率、AI 待处理、AI 失败等均按当前窗口内该班全部课堂任务汇总，避免误读为单任务指标。
- 【行为保持】`all/7d` 主窗口、默认 `all`、旧值兼容提示、摘要瘦身、百分比展示、分页导航与底部原始 JSON 调试入口均保持不变。
- 【边界保持】纯前端表达层收口，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-55

- 【本步解决】班级周报页仍停留在“最小展示”形态（`summary/overview/items` 技术态直出、仅前 10 条标题、分析层次弱）的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/weekly-report` 已收口为正式分析页结构：筛选区（时间窗口）-> 周报摘要 -> 周报概览 -> 明细区 -> 原始 JSON 调试区；页面首屏不再呈现接口结果浏览态。
- 【展示层升级】`summary` 与 `overview` 已改为友好化映射与分组展示，不再裸露技术 key；比率字段统一百分比格式；`items` 已升级为结构化表格预览（默认最多前 30 条）并保留总条数说明，不再仅展示前 10 条标题。
- 【窗口与兼容保持】主展示窗口继续为 `7d/30d/all`（默认 `all`），旧值 URL `24h` 继续兼容请求与展示，并在筛选区提供轻量“旧链接兼容”提示。
- 【调试入口保持】“查看原始周报 JSON”继续保留为低权重默认折叠区块，放在页面下方，不影响主叙事。
- 【边界保持】仅前端表达层优化，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-56

- 【本步解决】班级周报页在当前后端无独立明细数组时仍保留“周报明细”空区块，造成空盒子与表达割裂的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/weekly-report` 已移除空的“周报明细”区块（标题/说明/空态占位整体删除），页面结构收口为“筛选区 -> 周报摘要 -> 周报概览 -> 原始 JSON 调试区”。
- 【去重保持】`topTags` 继续仅在“风险与问题概览”中展示，不再迁移或复制到其它区块重复渲染。
- 【语义收口】页面在现有后端契约下明确定位为“汇总型周报”，不再硬造伪明细表。
- 【行为保持】时间窗口 `all/7d/30d` 主展示、`24h` 旧链接兼容提示、摘要区与概览区、原始 JSON 默认折叠入口均保持不变。
- 【边界保持】仅前端表达层优化，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-57

- 【本步解决】过程性评价页仍偏“接口最小展示页”（窗口切换 + 兜底字段表 + 调试块）的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/process-assessment` 已收口为正式分析页结构：筛选区（时间窗口）-> 过程性评价摘要 -> 过程性评价明细 -> 原始 JSON 调试区。
- 【摘要补齐】页面新增基于当前返回明细聚合的轻量摘要（学生条目数、高风险/中高风险人数、平均任务提交率、AI 请求成功率、有迟交记录人数），并明确为“当前窗口 + 当前返回明细”口径。
- 【明细友好化】表格已切换为 view-model 渲染，统一学生显示名、进度百分比文案、风险中文标签（高/中/低风险）与备注展示，不再在 JSX 中堆叠多层 `safeGet(...) ?? ...` 兜底表达。
- 【窗口与兼容保持】主展示窗口继续为 `7d/30d/all`（默认 `all`），旧值 URL `24h` 继续兼容并显示轻量提示；`csvHref` 继续沿用当前窗口 query。
- 【调试与导出保持】CSV 下载入口保留；原始 JSON 入口继续默认折叠并位于页面下方，避免干扰主叙事。
- 【边界保持】仅前端表达层优化，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-58

- 【本步解决】过程性评价页虽已有摘要与明细，但“正式评价语义”仍不够突出（缺少得分主列、topTags 教师化表达不足、rubric 口径未显式说明）的问题。
- 【摘要精修】摘要区已收敛为 5 项核心指标：学生人数、高风险学生数、平均任务提交率、平均得分、AI 请求成功率（均基于当前窗口与当前返回明细聚合）。
- 【得分显式化】明细表新增“得分”列并展示 `score`（轻量格式化，避免长小数），位置放在“进度”与“风险”之间，强化学生级评价结果可读性。
- 【问题摘要教师化】`topTags` 已增加中文友好映射（如可读性/正确性/风格/命名/缺陷风险），备注列优先展示真实 `comment/note`，无备注时回退“主要问题：...”并限制前 3 个标签方向。
- 【口径说明补齐】表格区上方新增低干扰“评价口径说明”，基于 `rubric` 动态生成四项权重文案（任务提交率/提交次数/AI 请求质量代理/代码质量代理）；`rubric` 缺失时自动降级不展示。
- 【行为保持】窗口主展示 `7d/30d/all`（默认 `all`）、`24h` 兼容提示、CSV 下载、原始 JSON 折叠调试入口与 query 透传逻辑均保持不变。
- 【边界保持】仅前端表达层二次抛光，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-59

- 【本步解决】过程性评价页 `topTags` 使用不完整中文映射后出现中英混用（如“可读性(1)”与“documentation(1)”并存）的问题。
- 【新增事实 / 已收口口径】`topTags` 已取消中文映射层，问题摘要统一回到英文原标签展示，格式保持“主要问题：tag (count), tag (count)”。
- 【一致性对齐】标签展示语义与复盘包等页面保持一致：不在当前阶段引入不完整翻译字典，避免同页中英混排。
- 【行为保持】备注列优先真实 `comment/note` 的规则保持不变；无备注时继续使用 `topTags` 兜底摘要（最多前 3 个）。
- 【边界保持】仅前端表达层一致性修正，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-60

- 【本步解决】过程性评价页在二次抛光后仍存在观感问题：学生列长 ID 过重、摘要区密度偏松、问题摘要列重复句式、表格主次层次仍可优化。
- 【学生列优化】在不新增后端接口前提下，学生列无姓名场景改为短 `studentId` 主展示（`前8位...后4位`），完整 `studentId` 通过 `title` 保留可追溯性，不再让长串 ID 抢占首屏。
- 【摘要区收紧】摘要区 5 项指标口径保持不变，卡片栅格与间距改为更紧凑布局（大屏更均衡），减少“3+2”松散感。
- 【问题摘要列优化】保留英文 `tag (count)` 摘要但去掉单元格内重复“主要问题：”前缀；备注列仍优先真实 `comment/note`，无备注时回退标签摘要，长文本做轻量截断并保留完整 `title`。
- 【表格层次优化】进度与得分主值强调、次级说明弱化，列宽与对齐进一步收口（学生/得分/风险更稳，问题摘要承担剩余空间），整体更接近正式评价表。
- 【筛选区弱化】`统计生成于` 保留但下调为更低权重次级信息，不再抢筛选主焦点。
- 【行为保持】窗口主展示 `7d/30d/all`（默认 `all`）、`24h` 兼容提示、CSV 下载、原始 JSON 折叠调试入口与 query 透传逻辑均保持不变。
- 【边界保持】仅前端展示层抛光，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-61

- 【本步解决】过程性评价页学生列仍向教师可见区域直显短 `studentId`（含 `title` 追溯）的问题。
- 【显示口径收口】学生列统一为“姓名 + 学号”：主文案固定 `studentName`，次级仅在 `studentNo` 存在时显示“学号：{studentNo}”；`studentNo` 缺失时不再显示任何 ID 文案。
- 【去除可见 ID】移除学生列中的 `ID xxx`、短 ID 与 `title` 内完整 `studentId` 可见展示；`studentId` 仅保留内部用途（如行 key/数据映射）。
- 【兼容保持】极端防御性兜底保留“未知学生”，不再使用 `studentId` 作为前端可见兜底文案。
- 【行为保持】窗口筛选、摘要区、得分列、风险/问题摘要、CSV 下载、原始 JSON 调试入口与 query 透传逻辑保持不变。
- 【边界保持】仅前端 process-assessment 页面收口，不改 backend 契约，不新增接口，不新增依赖。

## UAT-FE-62

- 【本步解决】教学快照页在教师主链路中仍以“正式导出页”形态暴露，造成产品定位错位的问题。
- 【入口治理】已确认并处理两个真实高频入口：`classroom dashboard` 与 `process-assessment` 顶部 actions 的“教学快照”链接均已移除；页面仍支持路由直达访问。
- 【页面定位降级】`/teacher/classrooms/[classroomId]/export/snapshot` 主标题与说明改为“教学快照预检（内部）”语义，明确其用途为导出前核对与内部诊断，不是教师高频业务页。
- 【信息架构收口】页面主阅读路径调整为“预检参数 -> 体积保护与截断提示 -> 快照元信息（预检） -> 快照预检摘要”，原始 JSON 区块保留但下沉为“原始快照数据（调试/核对用）”。
- 【能力保持】未删除页面与路由、未改后端接口调用契约、未新增真实文件导出能力（JSON/Word/PDF/Excel 均未新增）。
- 【边界保持】仅前端表达层与入口层级收口，不改 backend，不新增依赖。

## UAT-FE-63

- 【本步解决】学生任务详情页标题区出现“班级状态: —”低价值占位，影响信息聚焦的问题。
- 【展示收口】`/student/classrooms/[classroomId]/tasks/[classroomTaskId]` 页面标题区已移除 `classroom.status` 拼接，不再显示“班级状态”及其占位横杠。
- 【当前口径】标题仍展示任务名，副标题仅保留班级名称；不新增“任务状态”替代文案。
- 【行为保持】任务基础信息、提交区、AI 状态提示、历史记录、评分说明、query 参数交互均保持不变。
- 【边界保持】仅前端单页展示修正，不改 backend 契约，不新增依赖。

## UAT-FE-64

- 【本步解决】学生提交详情页 AI 反馈结果需手工刷新才能看到的问题。
- 【新增事实 / 已收口口径】`/student/submissions/[submissionId]` 已新增状态驱动自动刷新（最小 client 组件 + `router.refresh()`）：`PENDING/RUNNING` 快速刷新、`FAILED` 慢速刷新；到 `SUCCEEDED/DEAD/NOT_REQUESTED` 自动停止。
- 【资源保护】自动刷新已包含页面可见性保护（标签页不可见或页面失焦时暂停，回到前台后按当前状态恢复）与长时间状态不变降频策略。
- 【防重叠】同页实例内已加入本地互斥（`inFlight + transition pending`），且状态切换/组件卸载会清理旧 timer，避免重复定时器叠加。
- 【行为保持】未新增后端接口、未引入 WebSocket/SSE；请求按钮仍保持“仅 `NOT_REQUESTED` 可点，`FAILED` 不可手工重试”。

## UAT-FE-65

- 【本步解决】学生提交详情页自动刷新后，`RequestAiFeedbackButton` 可能滞留旧状态文案（如后端已 `DEAD` 仍显示“处理中/自动刷新”）的问题。
- 【新增事实 / 已收口口径】`RequestAiFeedbackButton` 已补齐父级状态同步：当页面刷新后 `initialStatus` 变化时，本地展示状态会同步覆盖到最新服务端状态。
- 【行为保持】`NOT_REQUESTED` 首次请求流程不变；`FAILED` 仍不可手动重试；自动刷新机制与频率策略不变。

## UAT-FE-66

- 【本步解决】学生任务详情页“最新 AI 状态”与提交记录表“AI 状态”在 AI 状态变化后需手工刷新才能更新的问题。
- 【新增事实 / 已收口口径】`/student/classrooms/[classroomId]/tasks/[classroomTaskId]` 已接入 AI 状态联动自动刷新：当 `submissions[*].aiFeedbackStatus` 存在 `PENDING/RUNNING` 时快速刷新；仅存在 `FAILED` 时慢速刷新；所有 submission 均非活跃时停止。
- 【覆盖范围】刷新走整页 `router.refresh()` 链路，顶部“最新 AI 状态”与底部提交表“AI 状态”列同步更新，不做局部前端假更新。
- 【资源保护与防重叠】沿用页面可见性暂停/恢复、长时间无变化降频、同页实例内互斥防重叠（避免 timer 叠加与并发 refresh）。
- 【行为保持】不改提交表交互、不改查看反馈跳转、不改后端接口与自动刷新状态机语义。

## UAT-FE-67

- 【本步解决】学生任务详情页自动刷新收尾阶段可能过早停刷，导致 `DEAD` 终态需手工刷新才稳定显示的问题。
- 【新增事实 / 已收口口径】任务详情页自动刷新驱动已从“仅 submissions 聚合单值”调整为“latest + submissions 状态集合”，使停刷判断与页面真实显示源一致。
- 【收尾修正】`SubmissionAutoRefresh` 新增最小终态收尾容错：活跃态结束后保留一次收尾刷新，再停止自动刷新，避免漏掉最后一跳终态展示。
- 【兼容保持】学生提交详情页继续可用（组件保持单状态输入兼容）；刷新频率语义、可见性暂停、降频与防重叠机制保持不变。

## UAT-FE-68

- 【本步解决】教师提交详情页只能新增反馈、无法修改已有教师反馈的问题。
- 【新增事实 / 已收口口径】`/teacher/submissions/[submissionId]` 已接入 `PATCH learning-tasks/submissions/:submissionId/feedback/:feedbackId`；反馈历史中仅 `source=TEACHER` 且有 `id` 的条目显示“修改”入口，AI/SYSTEM 反馈保持只读。
- 【交互收口】点击“修改”在当前反馈条目内原地展开编辑表单；同一时间只展开一个编辑表单；保存成功后 `router.refresh()` 刷新当前页面数据并收起编辑态，取消编辑不丢失页面上下文。字段开放口径已在 UAT-FE-69 收口。
- 【错误口径】空 `message` 前端拦截；400 显示“反馈内容不完整或格式不正确，请检查后再保存。”；403 显示“无权限修改该反馈，或该反馈不是可修改的教师反馈。”；404 显示“反馈不存在，可能已被更新或当前提交不匹配，请刷新页面后重试。”；5xx 显示“保存失败，请稍后重试。”。
- 【边界保持】仅前端接入与 handoff 同步，不改 backend，不新增反馈删除/版本历史/AI 人工改写能力。

## UAT-FE-69

- 【本步解决】新增教师反馈与编辑教师历史反馈字段口径不一致、且 `scoreHint` 容易被误读为正式评分的问题。
- 【新增事实 / 已收口口径】`TeacherFeedbackForm` 已补齐 `type` 选择；新增与编辑教师反馈的前端操作字段统一为 `type/severity/message/suggestion/tags`。
- 【scoreHint 口径】后端契约与前端 response 类型/mapper 继续兼容 `scoreHint`；教师前端 UI 暂不展示、不新增、不编辑、不主动提交该字段。
- 【边界保持】不改 backend 契约，不新增评分体系，不改变 AI/SYSTEM 反馈只读语义，不影响学生端反馈展示。

## UAT-FE-70

- 【本步解决】教师反馈标签可选但空值归一化口径提示不够清晰的问题。
- 【新增事实 / 已收口口径】新增与编辑教师反馈表单的标签区域均提示“可选，多选；不选将归为 other”，并补充“不选择时系统会按 other 处理”说明。
- 【展示边界】反馈历史中的 `tags` 继续按既有原始枚举值展示，不单独将 `other` 中文化，也不推进 `type/severity/tags` 统一中文化。
- 【边界保持】不改后端 `normalizeTeacherFeedbackTags`，不改变 POST/PATCH 请求结构，不新增标签必填校验，不恢复 `scoreHint` 前端入口。

## UAT-FE-71

- 【本步解决】学生看板任务列表 AI 状态中英文混排、缺少后端完成结论展示的问题。
- 【新增事实 / 已收口口径】`/student/dashboard` 的任务列表 AI 状态列已改为中文标签；新增“完成情况”列，直接消费后端 `completionStatus.status` 展示未提交/暂无反馈/已合格/基本合格/不合格。
- 【边界保持】完成情况不在前端按 `aiFeedbackStatus`、`mySubmissionsCount`、历史提交或额外接口二次推断；仅做旧响应兼容兜底。不改 backend，不新增依赖。

## UAT-FE-72

- 【本步解决】学生任务详情页 AI 状态中英文混排、且缺少 latest 完成结论展示的问题。
- 【新增事实 / 已收口口径】`/student/classrooms/[classroomId]/tasks/[classroomTaskId]` 顶部“最新 AI 状态”和历史提交 AI 状态均改为中文标签；顶部新增“完成情况”，直接消费后端顶层 `completionStatus.status` 展示未提交/暂无反馈/已合格/基本合格/不合格。
- 【边界保持】完成情况不在前端按 `submissions[]`、`latest.feedbackSummary`、`latest.feedbackItems` 或 `aiFeedbackStatus` 二次推断；历史提交 ERROR 不影响 latest 完成情况展示。不改 backend，不新增依赖。

## UAT-FE-73

- 【本步解决】教师班级看板默认视图被已关闭课堂任务干扰、但教师仍需要显式复盘 CLOSED 任务的问题。
- 【新增事实 / 已收口口径】`/teacher/classrooms/[classroomId]/dashboard` 新增“显示已关闭任务”开关；默认不传 `includeClosedTasks`，打开后请求 `GET classrooms/:id/dashboard?includeClosedTasks=true`，关闭后恢复默认请求。
- 【展示口径】CLOSED 任务依据 `classroomTaskStatus` 显示“已关闭”标签并做轻量弱化；ACTIVE 保持原展示。
- 【边界保持】任务集合与 summary 统计均以接口返回为准，前端不本地过滤 CLOSED、不二次扣减或重算统计。不改 backend，不新增依赖。

## UAT-FE-74

- 【本步解决】学生看板默认任务列表长期积累历史任务、但学生仍需要显式回看历史任务的问题。
- 【新增事实 / 已收口口径】`/student/dashboard` 新增“显示历史任务”开关；默认不传 `includeHistorical`，打开后请求 `GET classrooms/mine/dashboard?includeHistorical=true`，关闭后恢复默认请求。
- 【展示口径】`RECENTLY_EXPIRED` 任务显示“近期过期”标签；`HISTORICAL` 任务显示“历史任务”标签并做轻量弱化；旧响应缺少 `studentVisibilityStatus/isHistorical` 时按普通当前任务展示。
- 【边界保持】任务可见性只消费后端 `studentVisibilityStatus/isHistorical`，前端不按 `dueAt/publishedAt` 或本地过滤重算历史任务；任务集合、`total/page/limit` 与完成情况均以接口返回为准。不改 backend，不新增依赖。

## 当前阶段一句话结论

前端已达到“Teacher/Student 主链路可用 + 任务模板层与班级实例层边界收口 + 教师模板主链路可维护”的工程验收阶段，但尚未进入最终交付定版阶段。

## 新会话续接提醒（不要回退的口径）

- Members 与 classroomTask submissions 继续以真接口为主，不回退 workaround。
- Submission detail 继续以稳定读源为主，不回退 query 主数据。
- AI 默认联调继续使用 `Stub + worker`，不把 `process-once` 当主模式。
- 课程视角与 Teacher 起步入口已是主链路组成部分，不回退为“仅班级入口”。
- 任务模板层（`/teacher/tasks`）与班级实例层（`/teacher/classrooms/[classroomId]/tasks`）继续分层，禁止回退为混合流。
