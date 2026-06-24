# EduForge 前端新会话交接包（入口）

本交接包基于以下权威来源整理，目标是让新会话在不依赖当前聊天上下文的情况下直接续接前端开发：

- `frontend/**` 当前工作区源码（最高优先级）
- `docs/frontend-architecture.md`
- `docs/handoff/handoff-*.md`（后端交接口径）

若文档与代码冲突，一律以当前 `frontend/**` 代码为准。

## 旧宪法事实迁移说明

- 2026-06-24 已将旧 `docs/frontend-architecture.md` 中的 EduForge 前端事实迁移/对齐到本入口、route-map、component-map、frontend-snapshot 与相关后端 handoff。
- 后续如 7 个通用宪法文档被覆盖，前端路由、BFF、role gate、页面接口、AI Feedback 与过程性评价 UI 事实以 `docs/handoff/**` 为项目锚点。
- 当前代码口径：正式 BFF 代理变量是 `FRONTEND_BACKEND_ORIGIN`；旧示例中的 `BACKEND_URL` 不作为当前前端事实。

## 文档导航（前端）

| 文档 | 用途 | 新会话何时看 |
|---|---|---|
| `docs/handoff/handoff-frontend-snapshot.md` | 前端全局事实快照（架构、主链路、真接口收口、AI 联调模式） | 新会话第一步先看 |
| `docs/handoff/handoff-frontend-changelog.md` | 阶段演进结论（Step 8~12） | 需要快速理解“本会话最后一段做了什么”时 |
| `docs/handoff/handoff-frontend-route-map.md` | 路由地图（页面用途/主接口/完成度/稳定读源） | 要改页面或补链路前 |
| `docs/handoff/handoff-frontend-component-map.md` | 组件与模块职责边界（在哪改、不要在哪改） | 要改组件或公共机制前 |
| `docs/handoff/handoff-frontend-manual-checklist.md` | Step 12 人工验收清单 | 联调冒烟或交接验收时 |

## 推荐阅读顺序（新会话）

启动新会话时，建议先快速阅读 `docs/handoff/handoff-INDEX.md`（后端入口），再按下列前端顺序继续。

1. `handoff-frontend-snapshot.md`
2. `handoff-frontend-changelog.md`
3. `handoff-frontend-route-map.md`
4. `handoff-frontend-component-map.md`
5. `handoff-frontend-manual-checklist.md`

## 需要与后端交叉阅读的文档

后端交接口径、运行模式、DTO、服务职责边界等基线请以 `docs/handoff/handoff-INDEX.md` 为入口再向下展开。

- `docs/handoff/handoff-INDEX.md`
- `docs/handoff/handoff-api-map.md`
- `docs/handoff/handoff-dto-cheatsheet.md`
- `docs/handoff/handoff-decisions.md`
- `docs/handoff/handoff-snapshot.md`
- `docs/handoff/handoff-config-matrix.md`
- `docs/handoff/handoff-service-map.md`

## 前端续接硬约束（当前实现口径）

- 所有业务请求统一经 `frontend/lib/api/{client,browser-client}.ts` 走 `/api/proxy/**`。
- Teacher / Student 主链路已打通，submission detail 主读源已接入 `GET /api/learning-tasks/submissions/:id`。
- P0 真接口前端已收口：`/users/me`、`/classrooms/:id/students`、`/classrooms/:classroomId/tasks/:classroomTaskId/submissions`、`/learning-tasks/submissions/:id`。
- AI 闭环默认联调模式遵循后端决策：`Stub + worker`（`request` 负责入队，worker 负责消费）。
