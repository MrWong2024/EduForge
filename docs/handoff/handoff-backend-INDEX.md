# EduForge 后端新会话交接包（入口）

本交接包基于 `backend/` 源码与现有 `docs/` 生成，用于在**不依赖当前聊天上下文**的前提下，直接续接开发。

后端 handoff 当前入口：`docs/handoff/handoff-backend-INDEX.md`。前端 handoff 当前入口：`docs/handoff/handoff-frontend-INDEX.md`。

## 旧宪法事实迁移说明

- 2026-06-24 已把 7 个旧宪法文档中夹带的 EduForge 项目专属事实补充到 `docs/handoff/**`。
- `docs/` 下 7 个通用宪法文档只承载通用工程规则；EduForge 的认证、接口、DTO、配置、数据库、测试、AI Feedback 与过程性评价事实以 `docs/handoff/**` 为项目锚点。
- 若 handoff 与当前代码冲突，仍以当前工作区代码为准，并同步修订对应 handoff。

## 文档导航

| 文档 | 用途 | 何时查它 |
|---|---|---|
| `docs/handoff/handoff-backend-snapshot.md` | 全局事实快照：目录骨架、领域模型、协议口径、关键链路 | 新会话刚开始，先建立系统全貌 |
| `docs/handoff/handoff-backend-api-map.md` | 控制器接口地图（method/path/用途/门禁） | 要找接口入口、排查某条 API 归属 |
| `docs/handoff/handoff-backend-config-matrix.md` | 运行模式与环境变量矩阵（stub/mock/real） | 要切换 AI 模式、调 worker/debug 或排查配置 |
| `docs/handoff/handoff-backend-testing-playbook.md` | E2E 测试作战手册与 mock server 注入方式 | 跑回归、复现实验、定位测试失败 |
| `docs/handoff/handoff-backend-service-map.md` | 服务职责地图（Service Cards） | 需要改某个 service 前先看边界/依赖/失败路径 |
| `docs/handoff/handoff-backend-decisions.md` | 关键决策记录（Decision/Rationale/Consequences） | 评估改动是否违背既有架构决策 |
| `docs/handoff/handoff-backend-dto-cheatsheet.md` | 写接口 DTO 最小请求体速查（required/枚举/嵌套/最小 JSON 示例） | 前端/脚本联调遇到 400 校验、需要快速拼请求 body 时 |

## 前端入口补充

- 若新会话涉及前端续接，请同时阅读 `docs/handoff/handoff-frontend-INDEX.md`；后端以本文件为入口，前端以 `handoff-frontend-INDEX.md` 为入口。

## 统一前提

- 本项目使用 git/GitHub 进行版本管理；AI 协作开发时，代码事实以当前工作区或用户指定 commit 为准，handoff 用于交接业务事实，不替代代码核对。
- Node.js/NestJS/MongoDB 版本策略只引用 `docs/backend-architecture.md`，不重复展开。
- 系统为新系统，无 legacy 数据；本交接包不包含任何 legacy 迁移策略。
- P0 / 主链路已同步的后端事实（以代码为准）：`PATCH /api/users/me` 已可用；`POST /api/users/me/change-password` 已可用（校验旧密码，成功后保留当前会话并失效其它会话）；`GET /api/classrooms/:id/students` 默认只返 Enrollment ACTIVE，`includeRemoved=1/true` 可包含 REMOVED；`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 只认 `classroomTaskId`；`GET /api/learning-tasks/submissions/:id` 已作为 submission detail 稳定读源。
- 平台仍不开放公开注册（无前端注册页、无开放注册接口）；仍无产品化管理员批量导入功能（后台页面/管理接口/Excel 上传）。
- 已有运维脚本级 CSV 导入能力：`backend/scripts/import-users.ts`，执行入口 `npm run import-users -- --file="..." [--dry-run] [--reset-password]`。
- 连接串口径：应用运行读取 `MONGO_URI`；运维导入脚本读取 `MONGO_ADMIN_URI`。
- `handoff-backend-dto-cheatsheet.md` 仅覆盖 Controller 写接口（POST/PATCH/PUT/DELETE） 的 `@Body()` 最小样例；`@Query`/`@Param` 默认不展开。
- DTO 以 backend 源码为准；若 `handoff-backend-dto-cheatsheet.md` 与代码不一致，以代码为准并需同步修订 `handoff-backend-dto-cheatsheet.md`。
