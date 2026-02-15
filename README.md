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

## 开发辅助

- IDE：Visual Studio Code
- AI 辅助：GPT-5.2-Codex

## 工程约定（重要）

- 本仓库以 `docs/` 中的文档作为工程规范来源
- 后端架构规范：docs/backend-architecture.md（必须遵循）
- 禁止随意引入未约定的目录结构
- 前端采用严格的 features 模块化设计
- 后端采用 controller / service / dto / schema 分层结构

## AI / Agent 使用约定（重要）

本项目在开发过程中允许使用 AI（如 GPT-5.2-Codex）辅助生成代码，
但必须严格遵循以下约定：

### 1. 架构规范优先

- 所有后端结构、分层、模块设计，必须严格遵循：
  - `docs/backend-architecture.md`
- 任何通过 AI（Agent）执行的修改，指令中必须显式声明：
  > “严格遵循 docs/backend-architecture.md 的规范”

### 2. 执行与评审分离

- Codex（Agent）：**只负责生成和修改代码**
- Chat（网页端）：**只负责代码评审、架构分析与风险提示**
- 评审阶段不得直接修改代码，任何代码修改必须回到 Codex 执行

### 3. 依赖与版本控制

- 所有第三方依赖（dependencies / devDependencies）**必须由开发者手动决定并安装**
- AI（Agent）不得擅自修改 `package.json`
- AI（Agent）不得引入任何 `@types/*` 包
- 如发现缺失依赖，只允许在评审中指出依赖名称与推荐版本，不得自动添加

### 4. 详细规则

- AI / Agent 的完整执行规则与约束，参见：
  - `docs/codex-rules.md`

## 目录结构

EduForge/
├─ backend/            # NestJS 后端（唯一后端）
├─ frontend/           # Next.js 前端（教师端 / 学生端）
├─ docs/               # 所有工程与设计文档（非常重要）
├─ scripts/            # 工程脚本（初始化、迁移、维护）
├─ .gitignore
├─ README.md

## 数据库使用说明

- 数据库按环境隔离使用（development / test / production），禁止共用数据库。
- 应用运行时仅允许使用 *_app 类型的 MongoDB 账号连接数据库。
- Mongoose 的 autoIndex 策略：
  - development：开启
  - test / production：关闭
- 所有索引变更必须通过以下命令显式同步：
```bash
npm run sync-indexes
```
## AI Feedback Environment Variables

- AI_FEEDBACK_PROVIDER (default: stub; values: stub | openrouter)
- AI_FEEDBACK_REAL_ENABLED (default: false)
- AI_FEEDBACK_MAX_CODE_CHARS (default: 12000)
- AI_FEEDBACK_MAX_CONCURRENCY (default: 2)
- AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE (default: 30)
- AI_FEEDBACK_MAX_ITEMS (default: 20)
- OPENROUTER_API_KEY (required when provider=openrouter and AI_FEEDBACK_REAL_ENABLED=true)
- OPENROUTER_BASE_URL (default: https://openrouter.ai/api/v1)
- OPENROUTER_HTTP_REFERER (default: https://eduforge.local)
- OPENROUTER_X_TITLE (default: EduForge)
- OPENROUTER_MODEL (default: openai/gpt-4o-mini)
- OPENROUTER_TIMEOUT_MS (default: 15000)
- OPENROUTER_MAX_RETRIES (default: 2)
- 禁止在应用运行时使用 root 或 admin 权限账号。
