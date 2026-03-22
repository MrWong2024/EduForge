# EduForge 后端新会话交接包（入口）

本交接包基于 `backend/` 源码与现有 `docs/` 生成，用于在**不依赖 git/commit** 的前提下，直接续接开发。

## 文档导航

| 文档 | 用途 | 何时查它 |
|---|---|---|
| `docs/handoff/handoff-snapshot.md` | 全局事实快照：目录骨架、领域模型、协议口径、关键链路 | 新会话刚开始，先建立系统全貌 |
| `docs/handoff/handoff-api-map.md` | 控制器接口地图（method/path/用途/门禁） | 要找接口入口、排查某条 API 归属 |
| `docs/handoff/handoff-config-matrix.md` | 运行模式与环境变量矩阵（stub/mock/real） | 要切换 AI 模式、调 worker/debug 或排查配置 |
| `docs/handoff/handoff-testing-playbook.md` | E2E 测试作战手册与 mock server 注入方式 | 跑回归、复现实验、定位测试失败 |
| `docs/handoff/handoff-p0-regression-checklist.md` | P0 后端补齐回归检查清单（users/me、classroom students、classroomTask submissions） | 前端接入前、阶段性交接或冒烟回归 |
| `docs/handoff/handoff-service-map.md` | 服务职责地图（Service Cards） | 需要改某个 service 前先看边界/依赖/失败路径 |
| `docs/handoff/handoff-decisions.md` | 关键决策记录（Decision/Rationale/Consequences） | 评估改动是否违背既有架构决策 |
| `docs/handoff/handoff-dto-cheatsheet.md` | 写接口 DTO 最小请求体速查（required/枚举/嵌套/最小 JSON 示例） | 前端/脚本联调遇到 400 校验、需要快速拼请求 body 时 |

## 前端入口补充

- 若新会话涉及前端续接，请同时阅读 `docs/handoff/handoff-frontend-INDEX.md`；后端以本文件为入口，前端以 `handoff-frontend-INDEX.md` 为入口。

## 统一前提

- 本项目当前不使用 git（本交接包按“工作区事实状态”交接）。
- Node.js/NestJS/MongoDB 版本策略只引用 `docs/backend-architecture.md`，不重复展开。
- 系统为新系统，无 legacy 数据；本交接包不包含任何 legacy 迁移策略。
- P0 / 主链路已同步的后端事实（以代码为准）：`PATCH /api/users/me` 已可用；`GET /api/classrooms/:id/students` 默认只返 Enrollment ACTIVE，`includeRemoved=1/true` 可包含 REMOVED；`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 只认 `classroomTaskId`；`GET /api/learning-tasks/submissions/:id` 已作为 submission detail 稳定读源。
- 平台仍不开放公开注册（无前端注册页、无开放注册接口）；仍无产品化管理员批量导入功能（后台页面/管理接口/Excel 上传）。
- 已有运维脚本级 CSV 导入能力：`backend/scripts/import-users.ts`，执行入口 `npm run import-users -- --file="..." [--dry-run] [--reset-password]`。
- 连接串口径：应用运行读取 `MONGO_URI`；运维导入脚本读取 `MONGO_ADMIN_URI`。
- `handoff-dto-cheatsheet.md` 仅覆盖 Controller 写接口（POST/PATCH/PUT/DELETE） 的 `@Body()` 最小样例；`@Query`/`@Param` 默认不展开。
- DTO 以 backend 源码为准；若 `handoff-dto-cheatsheet.md` 与代码不一致，以代码为准并需同步修订 `handoff-dto-cheatsheet.md`。
