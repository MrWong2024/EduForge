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
| `/teacher/courses/[courseId]/overview` | 课程总览 | `GET courses/:courseId/overview` | 页面结构收口为“筛选区 -> 课程摘要 -> 班级明细 -> 分页 -> 调试区”；去除 `window/sort/order/page` 技术态裸文本回显；筛选区风格向学习轨迹/课堂复盘页对齐；前端主展示窗口收口为 `all/7d`（默认 `all`，旧值 `1h/24h/7d` URL 仍兼容）；摘要区按“有意义优先”瘦身为班级总数、当前页班级数、当前页有提交班级数、当前页平均提交率、当前页平均 AI 成功率；比率字段（摘要+表格）统一百分比展示；筛选区保留独立 `顺序` 标签组（升序/降序），并固定展示“当前窗口”提示（旧值带“旧链接兼容”标记）；新增低权重“查看原始 JSON”折叠调试入口（直接复用当前 overview 响应） | Done | 真接口 |
| `/teacher/courses/[courseId]/edit` | 课程编辑页 | `GET courses/:id`、`PATCH courses/:id` | 从课程列表/课程总览进入编辑；支持修改 `code/name/term/courseLabel`，保存后回课程总览；overview 保持展示页职责 | Done | 真接口 |
| `/teacher/tasks` | 任务模板页 | `GET learning-tasks/tasks`、`POST learning-tasks/tasks` | 默认 `scope=mine`；支持视图切换 `mine/shared/all` 并同步 URL；`scope/courseLabel/status/knowledgeModule/stage/page` 全部由 URL 驱动并透传后端真实查询；列表采用标准分页（固定 `limit=20`，上一页/下一页）；列表显示 `visibility(私有/共享)`；非作者模板仅显示“查看”入口；默认排序按视图收口：`mine=最近更新优先`、`shared=PUBLISHED 优先`、`all=我的模板优先` | Done | 真接口 |
| `/teacher/tasks/[taskId]/edit` | 任务模板编辑/查看页 | `GET learning-tasks/tasks/:id`、`PATCH learning-tasks/tasks/:id` | 作者可编辑模板核心字段（含可选 `courseLabel`、`visibility`）、维护 rubric 基础配置、状态管理（DRAFT/PUBLISHED/ARCHIVED）；非作者共享模板进入只读查看模式；支持 `returnTo` 回跳上下文（优先返回原模板列表 URL，缺失/非法时回退 `/teacher/tasks`） | Done | 真接口 |
| `/teacher/classrooms` | 班级列表 + 创建班级 | `GET classrooms`、`GET courses`、`POST classrooms`、`PATCH classrooms/:id`、`DELETE classrooms/:id` | 默认按 `进行中/已归档/全部` 视图区分展示（`statusView` query 驱动；列表请求透传 `status`）；支持创建班级；班级生命周期动作收进“更多”次级菜单（`ACTIVE: 归档/删除`，`ARCHIVED: 恢复/删除`）；空态动作按视图收口：`archived` 空态仅“查看进行中班级”，`active/all` 空态不再额外展示“创建班级”；删除作为危险次级操作，命中 `409 + CLASSROOM_NOT_EMPTY` 时给出明确提示“该班级已有成员或任务记录，不能删除，只能归档”；操作后通过 `router.refresh()` 刷新并保持当前视图 query | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/edit` | 班级编辑页 | `GET classrooms/:id`、`PATCH classrooms/:id` | 编辑班级基础信息（当前仅班级名称）；`Archived` 状态更新失败时展示后端错误口径；班级生命周期动作统一在列表页处理 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]` | 班级入口 | - | 重定向到 dashboard | Done | - |
| `/teacher/classrooms/[classroomId]/dashboard` | 班级看板 | `GET classrooms/:id`、`GET classrooms/:id/dashboard` | 导航到 tasks/members/report/export | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks` | 班级任务列表/发布页（班级实例层） | `GET classrooms/:id`、`GET classrooms/:id/tasks`、`GET classrooms/:id/publishable-task-templates`、`POST classrooms/:id/tasks`、`PATCH classrooms/:classroomId/tasks/:classroomTaskId/status`、`PATCH classrooms/:classroomId/tasks/:classroomTaskId` | 候选池由发布候选接口实时检索；`courseLabel/onlyMine/knowledgeModule/stage` 写入 URL 并透传后端查询；`courseLabel` 下拉选项来自统一标准课程分类列表（非候选结果倒推）；后端内置“仅 `PUBLISHED` + 排除本班已发布模板 + 课程优先排序”；首屏加载 `page=1&limit=50`，当 `total` 更大时支持“加载更多”追加后续页（非完整分页器）；筛选变化回到第一页并重置已追加候选；选择“当前教师可见的已发布模板（我的+可见共享）”并配置 `dueAt/allowLate/maxAttempts` 发布实例；课堂任务实例列表展示 `ACTIVE/CLOSED/RECALLED` 状态，`ACTIVE` 可执行“关闭任务”，`CLOSED` 可执行“恢复提交”（`status=ACTIVE`），`ACTIVE/CLOSED` 可执行“编辑设置”（更新 `dueAt/allowLate/maxAttempts`），`RECALLED` 仅展示状态；进入详情/提交/三件套、跳模板页 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]` | 课堂任务详情 | `GET classrooms/:id`、`GET classrooms/:id/tasks/:classroomTaskId`、`POST learning-tasks/tasks/:id/publish` | 查看课堂任务与其底层 learning task 的基础状态，必要时触发底层 task publish | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` | 课堂任务提交管理 | `GET classrooms/:id`、`GET classrooms/:classroomId/tasks/:classroomTaskId/submissions` | 查看提交、跳转批阅页 | Done | P0 真接口 |
| `/teacher/submissions/[submissionId]` | 教师提交详情/批阅 | `GET learning-tasks/submissions/:id`、`GET learning-tasks/submissions/:id/feedback`、`POST learning-tasks/submissions/:id/feedback` | 查看代码与反馈、新增教师反馈 | Done | 稳定读源 + 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` | 学习轨迹 | `GET .../learning-trajectory` | 主展示窗口 `all/7d`（默认 `all`）；兼容 URL 旧值 `24h/30d`（继续请求但不在主 tabs 展示）；window/sort/order/include* 切换；主表“错误数变化（最近 vs 首次）”显示增加/减少/无变化语义；`includeAttempts/includeTagDetails` 在主视图显示可见扩展区；attempts 中“总反馈”使用 `feedbackCount`（非 `feedbackSummary.totalItems`） | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` | 课堂复盘（证据型） | `GET .../review-pack` | 主展示窗口 `all/7d`（默认 `all`）；兼容 URL 旧值 `24h/30d`（继续请求但不在主 tabs 展示）；`window/topK/examplesPerTag` 切换；主视图聚焦总览/问题聚合/典型样例/学生分层；样例卡片可跳转对应提交详情 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` | AI 指标 | `GET .../ai-metrics` | 窗口集合与默认值保持原策略（`1h/24h/7d`），仅做 window/includeTags 切换 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/members` | 班级成员管理 | `GET classrooms/:id`、`GET classrooms/:id/students`、`POST classrooms/:id/students/:uid/remove` | 成员列表、移除成员 | Done | P0 真接口 |
| `/teacher/classrooms/[classroomId]/weekly-report` | 班级周报 | `GET classrooms/:classroomId/weekly-report` | 主展示窗口 `7d/30d/all`（默认 `all`）；兼容 URL 旧值 `24h`（继续请求但不在主 tabs 展示）；window 切换 | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/process-assessment` | 过程性评价 | `GET classrooms/:classroomId/process-assessment`、`GET classrooms/:classroomId/process-assessment.csv` | 主展示窗口 `7d/30d/all`（默认 `all`）；兼容 URL 旧值 `24h`（继续请求但不在主 tabs 展示）；window 切换、CSV 下载（沿用当前 window） | Done | 真接口 |
| `/teacher/classrooms/[classroomId]/export/snapshot` | 教学快照 | `GET classrooms/:classroomId/export/snapshot` | window/includePerTask/limit* 切换、显示 `meta.notes` | Done | 真接口 |

## 3) Student 路由

| Route | 页面用途 | 主接口（经 `/api/proxy/**`） | 关键交互 | 完成度 | 稳定读源/真接口 |
|---|---|---|---|---|---|
| `/student` | 学生入口 | - | 重定向到 `/student/dashboard` | Done | - |
| `/student/dashboard` | 学习看板 | `GET classrooms/mine/dashboard` | 查看班级与任务、跳任务详情 | Done | 真接口 |
| `/student/classrooms/join` | 加入班级 | `POST classrooms/join` | 输入 joinCode 入班 | Done | 真接口 |
| `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` | 学生任务详情与提交页 | `GET .../my-task-detail`、`POST .../submissions` | 基于 `my-task-detail` 聚合结果展示任务基础信息、任务说明、评分标准与历史提交；支持提交作业并进入 submission detail 查看反馈 | Done | 真接口 |
| `/student/submissions/[submissionId]` | 学生提交详情/反馈 | `GET learning-tasks/submissions/:id`、`GET learning-tasks/submissions/:id/feedback`、`POST learning-tasks/submissions/:submissionId/ai-feedback/request` | 查看代码与反馈、请求 AI | Done | 稳定读源 + 真接口 |
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
