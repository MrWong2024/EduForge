# EduForge 后端新会话交接包（入口）

本交接包基于 `backend/` 源码与现有 `docs/` 生成，用于在**不依赖 git/commit** 的前提下，直接续接开发。

## 文档导航

| 文档 | 用途 | 何时查它 |
|---|---|---|
| `docs/handoff/handoff-snapshot.md` | 全局事实快照：目录骨架、领域模型、协议口径、关键链路 | 新会话刚开始，先建立系统全貌 |
| `docs/handoff/handoff-api-map.md` | 控制器接口地图（method/path/用途/门禁） | 要找接口入口、排查某条 API 归属 |
| `docs/handoff/handoff-config-matrix.md` | 运行模式与环境变量矩阵（stub/mock/real） | 要切换 AI 模式、调 worker/debug 或排查配置 |
| `docs/handoff/handoff-testing-playbook.md` | E2E 测试作战手册与 mock server 注入方式 | 跑回归、复现实验、定位测试失败 |
| `docs/handoff/handoff-service-map.md` | 服务职责地图（Service Cards） | 需要改某个 service 前先看边界/依赖/失败路径 |
| `docs/handoff/handoff-decisions.md` | 关键决策记录（Decision/Rationale/Consequences） | 评估改动是否违背既有架构决策 |

## 统一前提

- 本项目当前不使用 git（本交接包按“工作区事实状态”交接）。
- Node.js/NestJS/MongoDB 版本策略只引用 `docs/backend-architecture.md`，不重复展开。
- 系统为新系统，无 legacy 数据；本交接包不包含任何 legacy 迁移策略。
