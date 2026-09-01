# EduForge 前端 Handoff 入口

## 1. 文档定位与权威来源

- 本 INDEX 只负责前端 handoff 的导航、推荐阅读顺序和文档 Owner 指引，不维护阶段日志或实现明细。
- [项目 Roadmap](./handoff-roadmap.md) 是产品主线、工作包状态、近期计划和延期方向的唯一 Owner；本 INDEX 不复制这些事实。
- [Frontend snapshot](./handoff-frontend-snapshot.md) 维护当前前端高层实现事实；route、API、component 与 design baseline 分别维护专项事实。
- 具体实现与文档冲突时，以当前 `frontend/**` 源码或用户指定 commit 为准，并修订对应 Owner 文档。

## 2. 推荐阅读顺序

1. 需要确认当前产品主线或工作包状态时，先读 [项目 Roadmap](./handoff-roadmap.md)。
2. 需要建立前端全貌时，读 [Frontend snapshot](./handoff-frontend-snapshot.md)。
3. 修改页面、组件、布局、样式或用户交互前，读 [Frontend design baseline](./handoff-frontend-design-baseline.md)。
4. 按任务进入 route、API 或 component map；涉及后端合同时，从 [Backend Handoff 入口](./handoff-backend-INDEX.md) 进入后端 Owner。

## 3. 文档导航与 Owner

| 文档 | 唯一职责 / Owner 范围 |
|---|---|
| [项目 Roadmap](./handoff-roadmap.md) | 当前产品主线、工作包状态、近期计划与明确延期项 |
| [Frontend snapshot](./handoff-frontend-snapshot.md) | 当前前端工程结构、能力范围、高层实现事实与真实未实现边界 |
| [Frontend route map](./handoff-frontend-route-map.md) | 路由、页面职责、访问边界、主要交互与数据来源 |
| [Frontend API map](./handoff-frontend-api-map.md) | API helper、BFF proxy、请求/响应、错误处理与 UI 对接 |
| [Frontend component map](./handoff-frontend-component-map.md) | 组件、模块、Hook、API client 的职责和修改边界 |
| [Frontend design baseline](./handoff-frontend-design-baseline.md) | EduForge 稳定的前端产品、视觉、交互与 UX 原则 |

跨端接口、DTO、配置、Service 与稳定决策分别由 [Backend API map](./handoff-backend-api-map.md)、[Backend DTO cheatsheet](./handoff-backend-dto-cheatsheet.md)、[Backend config matrix](./handoff-backend-config-matrix.md)、[Backend Service map](./handoff-backend-service-map.md) 和 [Backend decisions](./handoff-backend-decisions.md) 维护。

## 4. 同步规则

- 产品范围、工作包状态或当前主线变化时更新 Roadmap。
- 前端高层结构、能力范围或真实未实现边界变化时更新 snapshot。
- 路由、API 对接、组件职责或稳定设计原则变化时，只更新对应专项 Owner；其他文档按需更新引用或高层投影。
- 仅当导航入口、推荐阅读顺序或文档职责变化时更新本 INDEX；遵循 `reference, don't restate`，不在此维护技术栈、API 明细、运行模式、测试事实或工作包状态。
