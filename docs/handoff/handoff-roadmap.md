# EduForge 项目 Roadmap

## 1. 文档定位

本文是 EduForge 产品主线、工作包状态和近期计划的唯一 Owner。Roadmap 只保留高层范围和状态，不维护 Schema、API、字段清单、完整验收测试、开发日志或 release notes。

- 当前实现全貌分别见 [Backend snapshot](./handoff-backend-snapshot.md) 与 [Frontend snapshot](./handoff-frontend-snapshot.md)。
- API、DTO、Service、配置、路由、组件和稳定设计原则由对应 map、matrix、snapshot 与 design baseline 维护。
- 已完成工作只保留压缩状态与权威文档引用；实现演进由 Git 追溯。

## 2. 状态语义

| 状态 | 含义 |
|---|---|
| `CURRENT` | 已成为当前产品基线的能力与边界 |
| `ACTIVE` | 已启动、正在推进的工作包 |
| `PLANNED` | 已明确为下一主线，但尚未开始实施 |

## 3. 当前产品基线（CURRENT）

EduForge 当前是面向教师与学生的教学任务平台，已形成以下主链路：

- 教师维护课程、班级和任务模板，将已发布模板形成课堂任务实例，并管理成员、提交与反馈。
- 学生加入班级、查看学习任务、提交作业、查看反馈，并在允许状态下请求 AI Feedback。
- 教师可通过班级看板、课程总览、周报、学习轨迹、课堂复盘、过程性评价、AI 指标和 AI 反馈介入成效分析进行教学判断与干预。
- 认证、角色边界、前后端真实接口链路和 AI Feedback 的产品请求/后台消费链路已经形成当前工程基线。

详细当前事实和真实未实现边界只在 backend/frontend snapshot 与专项 maps 中维护，Roadmap 不复制其接口或字段细节。

## 4. 文档与测试治理基线（CURRENT）

- 7 份通用工程治理文档已完成当前基线对齐，此后按 EduForge 自身治理需求独立演进，以当前仓库版本为准。
- 项目 handoff 已建立 Roadmap、Frontend Design Baseline、导航型 INDEX 与“一事实一 Owner”结构。
- Backend / Frontend Testing Playbook、测试数据库职责和最低充分 Browser evidence 治理已建立。

## 5. 文本教学任务承载（CURRENT）

首批文本教学任务承载工程范围已闭合：沿 Task → ClassroomTask → Submission → Feedback，支持固定发布内容、源码与独立说明、实例平台 AI 策略、完整文本辅助评阅及用量读取，并形成教师发布、学生提交、人工反馈和修订的真实前后端页面链。

- 后端合同、前端页面及对应工程验收完成；隔离数据库与合成账号的 Agent-assisted Browser smoke 使用现有 stub，代表性只读/失败恢复、草稿保护与响应式操作已闭合。
- 详细合同由 [Backend API](./handoff-backend-api-map.md)、[Backend DTO](./handoff-backend-dto-cheatsheet.md) 与 [Frontend API](./handoff-frontend-api-map.md) / [Component Map](./handoff-frontend-component-map.md) Owner 维护；证据职责及验收支持见 [Backend testing playbook](./handoff-backend-testing-playbook.md) 和 [Frontend testing playbook](./handoff-frontend-testing-playbook.md)。
- 真实模型质量、教学可理解性及真实课堂效果尚未验证；工程完成不等于真实课堂试教通过。

## 6. 维护规则

1. 产品主线、工作包状态或近期计划变化时更新本文。
2. Roadmap 不复制 API、DTO、Schema、字段矩阵、测试轮次、测试数量或实现流水；这些事实回到各自 Owner。
3. 工作包完成后压缩为高层目标、最终状态和权威引用，不长期保留逐步开发过程。
4. `CURRENT`、`ACTIVE` 与 `PLANNED` 必须按真实状态使用。
