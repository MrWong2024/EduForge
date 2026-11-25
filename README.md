# 智炼（EduForge）

## 项目简介

智炼（EduForge）是面向程序设计课程的教学实践平台。教师发布课堂任务，学生提交代码与说明，教师结合 AI 反馈和学生的多次提交记录开展讲评。

## 技术栈

- Node.js 24.x（项目运行时）
- Next.js 16.x（App Router）
- NestJS 11.x
- MongoDB
- TypeScript

## 仓库结构

- `backend/` 存放 NestJS 后端服务。
- `frontend/` 存放 Next.js 教师端和学生端页面。
- `docs/` 存放架构规范、协作规则和交接文档。

## 本地启动

1. 准备 Node.js 24.x 和本地 MongoDB 单节点副本集 `rs0`。开发库要求见[后端配置矩阵的数据库章节](docs/handoff/handoff-backend-config-matrix.md#1-数据库连接串与索引治理)。
2. 复制以下两个示例文件，按本机环境填写所需配置。
   - 将 [backend/.env.development.example](backend/.env.development.example) 复制为 `backend/.env.development`。
   - 将 [frontend/.env.local.example](frontend/.env.local.example) 复制为 `frontend/.env.local`。
3. 打开两个独立终端，两个终端都从仓库根目录开始。

   **终端一启动后端**

   ```sh
   cd backend
   npm ci
   npm run start:dev
   ```

   **终端二启动前端**

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   前端启动后，访问 [http://localhost:3000](http://localhost:3000)。

## 文档入口

- [后端架构规范](docs/backend-architecture.md)
- [前端架构规范](docs/frontend-architecture.md)
- [Codex 执行规则](docs/codex-rules.md)
- [Codex 指令编写规范](docs/codex-instruction-spec.md)
- [后端交接文档索引](docs/handoff/handoff-backend-INDEX.md)
- [前端交接文档索引](docs/handoff/handoff-frontend-INDEX.md)
- [后端配置矩阵](docs/handoff/handoff-backend-config-matrix.md)
