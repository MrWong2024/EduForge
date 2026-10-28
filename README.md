# EduForge

EduForge is a modern teaching practice platform built with NestJS, Next.js, and MongoDB.

---

## 项目简介

EduForge 是一个面向软件工程实践教学的智能化教学平台，目标是为教师和学生提供统一、稳定、可扩展的实践教学支持环境。

本项目采用前后端分离架构，强调模块化设计、清晰的职责边界以及长期可维护性。

## 技术栈（实际依赖版本以 package.json 与锁文件为准）

- Node.js：最新 LTS（24.x）
- 前端：Next.js 16.x（App Router）
- 后端：NestJS 11.x（默认 Express v5）
- 数据库：MongoDB（环境版本目标见 [Config Matrix](docs/handoff/handoff-backend-config-matrix.md#1-数据库连接串与索引治理)）
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
- 分别进入 `backend/` 与 `frontend/` 目录用 `npm ci` 安装锁定依赖，再按需启动开发服务；Windows PowerShell 可用 `npm.cmd ci`。
- 涉及 AI feedback provider / worker / 调试开关等配置时，请直接查阅 `docs/handoff/handoff-backend-config-matrix.md`。

## 依赖维护

后端对 `@nestjs/platform-express` 的 `multer` 子依赖设置了限定范围的 `2.5.0` override，用于修复 [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)；NestJS 11 的当前适配器仍固定旧版本。上游采用修复版本后，应重新核对并移除该 override，不将它扩展为全局替换或通过 `--force` 忽略依赖冲突。

前端采用 ESLint 10，显式组合 JavaScript、TypeScript、Next.js、官方 React Hooks 和现代 React 检查，并以 `import-x`、`jsx-a11y-x` 承接现有 import 与无障碍职责。配置边界、TypeScript 承接与退役规则、静态 contract 见 [前端 testing playbook §4](docs/handoff/handoff-frontend-testing-playbook.md#4-pure--static-contract)；具体版本以 `frontend/package.json` 和锁文件为准。
