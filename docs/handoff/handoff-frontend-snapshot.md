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
  - `/teacher/tasks`：模板列表 + 创建 + 本地筛选（`status/knowledgeModule/stage`）
  - `/teacher/tasks/[taskId]/edit`：模板编辑与状态管理
- 教师班级实例层（已收口）：
  - `/teacher/classrooms/[classroomId]/tasks`：只选择已发布模板并发布到班级实例，不承担模板创建/编辑。
- `/student/**`：学习看板、加入班级、任务详情、提交、submission detail、请求 AI 已接入真接口。
- `/_demo/**`：独立 demo 沙箱，使用 `app/api/_demo/**` 内存数据，不参与主链路交付，不应作为正式 Teacher/Student 主链路实现参考。

## 3) 关键公共机制（已落地）

- 统一路由常量：`lib/routes/paths.ts`（含 `paths.teacher.tasks`、`taskEdit`、`tasksFromClassroom`）。
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
4. `/teacher/classrooms/[classroomId]/tasks` 选择已发布模板并设置 `dueAt/allowLate/maxAttempts` 后发布（`POST classrooms/:id/tasks`）
5. 进入 `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/*` 和提交管理页

Teacher 课程视角（可用）：
- `/teacher/courses` 已支持课程列表与创建课程。
- `/teacher/courses/[courseId]/overview` 已接入课程总览。
- 课程视角可作为进入班级创建/班级管理的上游入口（跳转到 `/teacher/classrooms` 或带 `courseId` 的班级页）。

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

Teacher 课堂复盘链路（可用）：
1. `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` 保持真接口与原 query 协议（`window/topK/examplesPerTag/includeStudentTiers/includeTeacherScript`）不变。
2. 页面主路径已收敛为“课堂结论摘要 -> 行动建议 -> 高频问题概览 -> 典型样例 -> 教学脚本 -> 原始数据（调试）”。
3. `Top Tags/Top Types/Top Severities` 与筛选标签已中文化；原始 JSON 调试块保留但默认折叠。
4. 教学脚本不再只显示首条 talking point，主视图展示前 3 条并支持展开更多。
5. 页面顶部新增“课堂总览”指标卡（提交覆盖、AI 成功率、逾期情况、样例数量、尝试分布）；典型样例已按 `examples(tag + samples)` 展开并优先展示真实反馈摘要/修改建议，减少“空心样例”。

## 5) P0 真接口前端收口情况（现状）

已接入并在页面使用：

- `GET /api/users/me`：登录态探针 + role gate。
- `GET /api/classrooms/:id/students`：成员页主读源。
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：教师提交管理页主读源。
- `GET /api/learning-tasks/submissions/:id`：Teacher/Student submission detail 主读源（稳定读源）。
- `GET /api/learning-tasks/tasks` + `POST /api/learning-tasks/tasks`：模板页列表与创建。
- `GET /api/learning-tasks/tasks/:id` + `PATCH /api/learning-tasks/tasks/:id`：模板编辑页详情与更新。
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
