# 前端当前事实快照（Path Base: `frontend/`）

## 0) 本文定位（强制口径）

本文是前端当前事实快照，用于新会话快速建立前端全貌；它保留强制口径、前端骨架、路由分区摘要、主链路可用性、真接口收口状态、高风险边界和细节文档索引，不是页面说明书。

- 具体实现以当前 `frontend/**` 源码或用户指定 commit 为最高优先级；与 handoff 冲突时先核对代码。
- 所有正式业务请求统一走同域 `/api/proxy/**`，不要在业务页绕过 proxy 直连后端。
- 代理目标由 `FRONTEND_BACKEND_ORIGIN` 决定，代理实现位于 `app/api/proxy/[...path]/route.ts`。
- 详细页面、路由、主接口与完成度看 `docs/handoff/handoff-frontend-route-map.md`。
- 前端 API helper、BFF proxy 与后端接口对接关系看 `docs/handoff/handoff-frontend-api-map.md`。
- 详细组件职责与“改哪里/不要改哪里”看 `docs/handoff/handoff-frontend-component-map.md`。
- 历史演进与旧口径收口原因看 `docs/handoff/handoff-frontend-changelog.md`，不要把 changelog 当当前事实 SoT。
- 后端接口、DTO、配置与运行模式分别看对应 `handoff-backend-*` 文件。

## 1) 前端骨架摘要

```text
frontend/
├─ app/
│  ├─ (auth)/{login,forgot-password,reset-password}
│  ├─ teacher/**
│  ├─ student/**
│  ├─ api/proxy/[...path]          # 正式 BFF 代理
│  ├─ _demo/** + api/_demo/**      # 本地 demo 沙箱，非主交付链
│  └─ {layout,error,not-found,page}
├─ components/
│  ├─ layout/{TeacherShell,StudentShell}
│  ├─ blocks/{PageHeader,EmptyState,ErrorState,Tabs,FloatingMoreMenu}
│  ├─ auth/**
│  ├─ teacher/**
│  ├─ student/**
│  └─ classroomTask/TaskContextHeader
└─ lib/
   ├─ api/{client,browser-client,error-presenter,types-*}
   ├─ auth/{session,role-home}
   ├─ routes/paths.ts
   ├─ learning-tasks/{course-labels,template-visibility-scope,template-list-sorting}.ts
   ├─ ui/{status,format,rubric}.ts
   └─ http/server-cookie.ts
```

## 2) 路由分区摘要

Auth：

- `/login` 已完成登录、`GET users/me` 探针与 role-home 跳转：`TEACHER -> /teacher/classrooms`，`STUDENT -> /student`。
- `/forgot-password` 与 `/reset-password` 已接真实接口；前端固定防枚举成功提示，重置 token 只从 URL query 读取，不持久化保存。

Teacher：

- `/teacher/**` 由 `app/teacher/layout.tsx` 做 server-side role gate；教师主链路覆盖课程、班级、任务模板、课堂任务实例、成员、提交批阅、三件套、周报、过程性评价、教学快照预检。
- 课程和班级列表已支持创建、基础编辑、归档/恢复/空对象删除；低频生命周期动作在列表“更多”菜单处理。
- 模板层（`/teacher/tasks*`）负责模板创建、筛选、编辑、可见性与生命周期；班级任务页只负责选择已发布模板并发布课堂任务实例。
- 课堂任务工作区以班级看板和任务列表为中枢，提交管理、学习轨迹、课堂复盘、AI 指标共用任务上下文导航。
- 过程性评价页面已接真实 JSON/CSV 接口，支持通过 `ExcludeTasksPanel` Client Component + `router.replace` 客户端软导航更新 `excludedTaskIds` 临时查询后重新计算、任务维度评分指标明细展示与导出；明细区提供用户可读的可展开评分规则说明，用于解释综合过程分、四个权重维度、任务维度统计和典型样例，不改变算法或接口；页面级细节看 route-map/component-map。

Student：

- `/student/**` 由 `app/student/layout.tsx` 做 server-side role gate。
- 学生看板、加入班级、任务详情与提交、submission detail、请求 AI 均已接真接口。
- 学生任务详情以 `my-task-detail` 为主读源，消费后端 `participationStatus` 与 `completionStatus`；模板当前状态不再作为前端二次阻断依据。

辅助：

- `/_demo/**` 与 `/api/_demo/**` 是独立 demo 沙箱，不参与主链路交付。
- 当前没有正式 `/ops/**` 前端页面；后端 debug/ops 接口关闭时返回 `404` 应按“功能未启用”理解。

## 3) 公共机制与职责边界

- API client：Server/RSC 使用 `lib/api/client.ts`，Client Component 使用 `lib/api/browser-client.ts`；两者统一拼 `/api/proxy/**` 并处理错误。
- Role gate：`lib/auth/session.ts` 通过 `GET users/me` 获取登录态，`app/teacher/layout.tsx` 与 `app/student/layout.tsx` 做角色边界。
- 路由常量：`lib/routes/paths.ts` 是教师/学生主链路路径单一来源，三件套导航优先改 `TaskContextHeader` 与 paths。
- 类型适配：教师/学生 payload 解析优先落在 `lib/api/types-teacher.ts` 与 `lib/api/types-student.ts`，不要在页面深层散写原始字段访问。
- 状态文案与 UI 工具：AI 状态、rubric 四维中文、日期/展示兜底分别在 `lib/ui/status.ts`、`lib/ui/rubric.ts`、`lib/ui/format.ts` 收口。
- 模板治理：`courseLabel`、`visibility/scope` 与默认排序分别由 `lib/learning-tasks/*` 单一来源维护。
- 页面组件边界：模板维护属于 `/teacher/tasks*`，班级任务页只做实例发布；过程性评价任务排除由 `ExcludeTasksPanel` Client Component 承载，通过 `router.replace` 客户端软导航更新临时 URL query；应用排除写入当前选中的 `excludedTaskIds`，清空排除删除 `excludedTaskIds` 且仅保留 `window + page=1`；不持久化、不写浏览器存储、不修改任务或成绩、不重算后端评分。

## 4) 主链路可用性摘要

Teacher 起步与教学链路：

1. 创建课程与班级，进入班级看板。
2. 在模板页创建/维护任务模板，按 `scope/courseLabel/status/knowledgeModule/stage` 走后端真实查询。
3. 在班级任务页从发布候选接口选择当前教师可见且 `PUBLISHED` 的模板，配置实例参数后发布。
4. 通过任务详情、提交管理、学习轨迹、课堂复盘、AI 指标完成教学观察与批阅。
5. 周报、课程总览、过程性评价、教学快照预检均已接入后端聚合接口；复杂页面结构与按钮行为以 route-map 为准。

Student 学习链路：

1. 加入班级后在 `/student/dashboard` 查看当前、近期过期或显式历史任务。
2. 在任务详情页读取任务说明、评分标准、完成情况和历史提交。
3. 提交代码后进入 submission detail 查看反馈，并可在允许状态下请求 AI Feedback。
4. `NOT_REQUESTED/PENDING/RUNNING/SUCCEEDED/FAILED/DEAD` 均有展示口径；自动刷新逻辑由专用组件承载。

## 5) 真接口收口状态

已接入并作为当前主读源/主写入口：

- `GET /api/users/me`：登录态探针 + Teacher/Student role gate。
- `GET /api/classrooms/:id/students`：教师成员页主读源，遵守 Enrollment-only。
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`：教师提交管理页主读源。
- `GET /api/learning-tasks/submissions/:id`：Teacher/Student submission detail 稳定读源。
- `GET/POST/PATCH /api/learning-tasks/tasks*` 与模板生命周期动作：任务模板创建、编辑、发布、归档和列表筛选。
- `GET /api/classrooms/:id/publishable-task-templates` + `POST /api/classrooms/:id/tasks`：班级实例发布主链路。
- `GET /api/classrooms/:classroomId/process-assessment` 与 `.csv`：过程性评价与任务排除后重新计算。
- `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`：学生产品级 AI Feedback 请求入口。

补充：`PATCH /api/users/me` 后端已可用，但当前前端仍未提供资料编辑 UI。

## 6) 高风险边界与当前阶段判断

不得回退：

- 不要绕过 `/api/proxy/**` 直连后端。
- 不要把 query 透传当 submission detail 主体数据源。
- 不要在班级任务页恢复模板创建/编辑职责。
- 不要用模板当前 `PUBLISHED/ARCHIVED` 状态阻断既有 classroomTask 的学生运行态；前端应消费后端状态信号。
- 不要在过程性评价页重算后端评分、持久化 `excludedTaskIds`，或把清空排除实现成会带上当前 checkbox 状态的提交。
- 不要把 raw JSON 调试块当主视图，也不要让主链路依赖 raw JSON 才能操作。

当前阶段：

- 已达到 Teacher/Student 主链路可用、P0 真接口前端收口、任务模板层与班级实例层职责清晰、过程性评价与 AI Feedback 产品入口可用。
- 仍未进入最终交付定版：部分页面保留低权重 raw JSON 调试块；正式 `/ops/**` 前端页面未建设；模板治理仍为 MVP（删除/复制/批量等能力未提供）；浏览器级自动化 smoke 尚未建立。

## 7) 细节文档索引

- 前端入口：`docs/handoff/handoff-frontend-INDEX.md`
- 路由地图：`docs/handoff/handoff-frontend-route-map.md`
- 前端 API 对接地图：`docs/handoff/handoff-frontend-api-map.md`
- 组件职责地图：`docs/handoff/handoff-frontend-component-map.md`
- 历史变更记录：`docs/handoff/handoff-frontend-changelog.md`
- 后端接口地图：`docs/handoff/handoff-backend-api-map.md`
- 后端配置矩阵：`docs/handoff/handoff-backend-config-matrix.md`
- 后端 DTO 速查：`docs/handoff/handoff-backend-dto-cheatsheet.md`
