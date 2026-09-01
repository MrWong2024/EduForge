# EduForge 后端 Handoff 入口

## 1. 文档定位与权威来源

- 本 INDEX 只负责后端 handoff 的导航、推荐阅读顺序和文档 Owner 指引，不维护阶段日志或实现明细。
- [项目 Roadmap](./handoff-roadmap.md) 是产品主线、工作包状态、近期计划和延期方向的唯一 Owner；本 INDEX 不复制这些事实。
- [Backend snapshot](./handoff-backend-snapshot.md) 维护当前后端高层实现事实；API、DTO、配置、Service、稳定决策和测试事实分别由下列专项文档维护。
- 具体实现与文档冲突时，以当前 `backend/**` 源码或用户指定 commit 为准，并修订对应 Owner 文档。

## 2. 推荐阅读顺序

1. 需要确认当前产品主线或工作包状态时，先读 [项目 Roadmap](./handoff-roadmap.md)。
2. 需要建立后端全貌时，读 [Backend snapshot](./handoff-backend-snapshot.md)。
3. 按任务进入 API、DTO、Service、配置、决策或测试专项文档，不从 INDEX 获取实现细节。
4. 涉及跨端链路时，再从 [Frontend Handoff 入口](./handoff-frontend-INDEX.md) 进入前端文档。

## 3. 文档导航与 Owner

| 文档 | 唯一职责 / Owner 范围 |
|---|---|
| [项目 Roadmap](./handoff-roadmap.md) | 当前产品主线、工作包状态、近期计划与明确延期项 |
| [Backend snapshot](./handoff-backend-snapshot.md) | 当前后端工程结构、能力范围、高层实现事实与真实未实现边界 |
| [Backend API map](./handoff-backend-api-map.md) | 后端 HTTP endpoint、用途、权限、请求/响应与错误口径 |
| [Backend DTO cheatsheet](./handoff-backend-dto-cheatsheet.md) | DTO、Query、字段形状、校验规则与最小请求示例 |
| [Backend Service map](./handoff-backend-service-map.md) | Service / Provider 职责、关键调用关系、约束与失败边界 |
| [Backend config matrix](./handoff-backend-config-matrix.md) | 环境变量、配置来源、默认/校验、数据库用途映射与运行模式 |
| [Backend decisions](./handoff-backend-decisions.md) | 已形成且仍有效的稳定项目决策、理由与影响 |
| [Backend testing playbook](./handoff-backend-testing-playbook.md) | 后端 Pure/Unit/HTTP E2E、测试数据库、fixture、verifier、cleanup 与测试证据 |

前端路由、API 调用、组件、设计原则以及 Browser evidence / smoke 治理从 [Frontend Handoff 入口](./handoff-frontend-INDEX.md) 进入对应 Owner。

## 4. 同步规则

- 产品范围、工作包状态或当前主线变化时更新 Roadmap。
- 后端高层结构、能力范围或真实未实现边界变化时更新 snapshot。
- endpoint、DTO、Service、配置、稳定决策或测试事实变化时，只更新对应专项 Owner；其他文档按需更新引用或高层投影。
- 仅当导航入口、推荐阅读顺序或文档职责变化时更新本 INDEX；遵循 `reference, don't restate`，不在此积累实现、配置、API、测试或工作包事实。
