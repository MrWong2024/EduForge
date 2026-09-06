# EduForge 项目 Roadmap

## 1. 文档定位

本文是 EduForge 产品主线、工作包状态、近期计划和明确延期方向的唯一 Owner。Roadmap 只保留高层范围和状态，不维护 Schema、API、字段清单、完整验收测试、开发日志或 release notes。

- 当前实现全貌分别见 [Backend snapshot](./handoff-backend-snapshot.md) 与 [Frontend snapshot](./handoff-frontend-snapshot.md)。
- API、DTO、Service、配置、路由、组件和稳定设计原则由对应 map、matrix、snapshot 与 design baseline 维护。
- 已完成工作只保留压缩状态与权威文档引用；实现演进由 Git 追溯。

## 2. 状态语义

| 状态 | 含义 |
|---|---|
| `CURRENT` | 已成为当前产品基线的能力与边界 |
| `ACTIVE` | 已启动、正在推进的工作包 |
| `PLANNED` | 已明确为下一主线，但尚未开始实施 |
| `DEFERRED` | 仅作为后续候选保留，不是当前承诺或隐含前置 |

## 3. 当前产品基线（CURRENT）

EduForge 当前是面向教师与学生的教学任务平台，已形成以下主链路：

- 教师维护课程、班级和任务模板，将已发布模板形成课堂任务实例，并管理成员、提交与反馈。
- 学生加入班级、查看学习任务、提交作业、查看反馈，并在允许状态下请求 AI Feedback。
- 教师可通过班级看板、课程总览、周报、学习轨迹、课堂复盘、过程性评价、AI 指标和 AI 反馈介入成效分析进行教学判断与干预。
- 认证、角色边界、前后端真实接口链路和 AI Feedback 的产品请求/后台消费链路已经形成当前工程基线。

详细当前事实和真实未实现边界只在 backend/frontend snapshot 与专项 maps 中维护，Roadmap 不复制其接口或字段细节。

## 4. 文档与测试治理基线（CURRENT）

### DG-01 — Documentation & Testing Governance Alignment

DG-01 已完成独立治理验收并收口为当前治理基线，不改变 EduForge 产品行为。最终结果为：

- DG-01 完成时，7 份通用工程治理文档已完成成熟上游基线同源对齐；此后按 EduForge 自身治理需求独立演进，以当前仓库版本为准。
- 项目 handoff 已建立 Roadmap、Frontend Design Baseline、导航型 INDEX 与“一事实一 Owner”结构。
- Backend / Frontend Testing Playbook、测试数据库职责和最低充分 Browser evidence 治理已建立。
- 独立 DG-01V 已验证同源性、项目污染、Owner 边界、Roadmap/Design/Testing 事实、Browser 治理、链接与 Git 范围，阻断门禁全部通过。

## 5. 下一产品主线（PLANNED）

### Learning Evidence Foundation Phase 1

这是 DG-01 之后已明确的下一条产品主线，目标是建立可追溯、可复用的学习证据基础，为后续验证与能力建模提供可靠输入。

当前仅确认方向和顺序；详细合同、数据模型、API、UI、验收范围与实施拆分尚未在本 Roadmap 中锁定，也尚未开始实现。

## 6. 后续候选方向（DEFERRED）

| 候选方向 | 当前处置 |
|---|---|
| Verification Foundation | 延后评估；不是当前工作包，也不作为 Learning Evidence Phase 1 的隐含完成条件 |
| Competency Foundation | 延后评估；需在学习证据基础与真实产品需求稳定后另行定界 |

候选方向只有在范围、Owner、依赖和验收合同被单独确认后，才可转为 `PLANNED` 或 `ACTIVE`。

## 7. 维护规则

1. 产品主线、工作包状态、近期计划或延期处置变化时更新本文。
2. Roadmap 不复制 API、DTO、Schema、字段矩阵、测试轮次、测试数量或实现流水；这些事实回到各自 Owner。
3. 工作包完成后压缩为高层目标、最终状态和权威引用，不长期保留逐步开发过程。
4. `CURRENT`、`ACTIVE`、`PLANNED` 与 `DEFERRED` 必须按真实状态使用；候选方向不得写成当前已实现事实或承诺。
