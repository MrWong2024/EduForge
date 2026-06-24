# EduForge

EduForge is a modern teaching practice platform built with NestJS, Next.js, and MongoDB.

---

## 项目简介

EduForge 是一个面向软件工程实践教学的智能化教学平台，目标是为教师和学生提供统一、稳定、可扩展的实践教学支持环境。

本项目采用前后端分离架构，强调模块化设计、清晰的职责边界以及长期可维护性。

## 技术栈（版本策略：使用最新稳定主版本，运行时采用最新 LTS）

- Node.js：最新 LTS（24.x）
- 前端：Next.js 16.x（App Router）
- 后端：NestJS 11.x（默认 Express v5）
- 数据库：MongoDB 8.x
- 语言：TypeScript

## 仓库结构概览

```text
EduForge/
├─ backend/            # NestJS 后端
├─ frontend/           # Next.js 前端（教师端 / 学生端）
├─ docs/               # 架构规范、协作规范与交接文档
├─ scripts/            # 工程脚本
└─ README.md
```

## 文档入口（权威读源）

- 后端架构规范：`docs/backend-architecture.md`
- 前端架构规范：`docs/frontend-architecture.md`
- AI/Agent 执行规则：`docs/codex-rules.md`
- 指令编写规范：`docs/codex-instruction-spec.md`
- 后端 handoff 入口：`docs/handoff/handoff-backend-INDEX.md`
- 前端 handoff 入口：`docs/handoff/handoff-frontend-INDEX.md`
- 运行模式与环境变量矩阵：`docs/handoff/handoff-backend-config-matrix.md`

详细的环境变量、联调与运行口径统一以上述文档为准，README 不重复维护细粒度配置字典。

## 简要启动说明

- 在本地准备 Node.js LTS 与 MongoDB 环境。
- 按需进入 `backend/` 与 `frontend/` 目录安装依赖并启动开发服务。
- 涉及 AI feedback provider / worker / 调试开关等配置时，请直接查阅 `docs/handoff/handoff-backend-config-matrix.md`。
