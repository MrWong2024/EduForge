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

## 5. 文本教学任务承载（ACTIVE）

面向源码文本与提交说明的教学活动，沿既有 Task → ClassroomTask → Submission → Feedback 链建立首批教学承载合同。

- A1：发布内容固定、提交说明、班级隔离与实例平台 AI 策略；后端范围完成，定向 unit/HTTP E2E 及 lint、完整 typecheck、build 门禁已通过。
- A2：完整文本 AI 辅助评阅、调用限额与实报用量读取；后端范围完成，定向 unit/HTTP E2E（含受控 stub Worker 循环）及 lint、完整 typecheck、build 门禁已通过。
- B1（ACTIVE）：基于稳定后端合同接入教师发布、学生提交/详情、教师查看与反馈。B1-1 页面实现与即时 pure/static 门禁已完成；B1-2 收到 B1-1 新 commit 后制定并执行真实师生 Browser 流程验收，含代表性恢复、草稿保护和响应式操作。B1 整体尚未完成。

A1、A2、B1 均完成并通过对应验收后才能关闭首批教学承载工作包；真实课堂效果另行验证。详细合同由 [API Map](./handoff-backend-api-map.md)、[DTO Cheatsheet](./handoff-backend-dto-cheatsheet.md)、[Service Map](./handoff-backend-service-map.md) 和 [Config Matrix](./handoff-backend-config-matrix.md) 维护。

## 6. 维护规则

1. 产品主线、工作包状态或近期计划变化时更新本文。
2. Roadmap 不复制 API、DTO、Schema、字段矩阵、测试轮次、测试数量或实现流水；这些事实回到各自 Owner。
3. 工作包完成后压缩为高层目标、最终状态和权威引用，不长期保留逐步开发过程。
4. `CURRENT`、`ACTIVE` 与 `PLANNED` 必须按真实状态使用。
