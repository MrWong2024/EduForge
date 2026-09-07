# 配置矩阵（Config Matrix）

## 0) 口径说明

- 本矩阵只维护配置入口、默认值与静态校验、环境映射及运行模式等当前配置事实；配置项、开关或运行模式存在，不等于对应 Service、route 或产品能力已经实现，也不代表测试资产已存在或证据已通过。当前实现能力与真实未实现边界见 [Backend Snapshot](./handoff-backend-snapshot.md)、[Frontend Snapshot](./handoff-frontend-snapshot.md) 及当前代码；测试资产、执行能力与证据状态见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 和 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。
 - env 默认值以 `backend/src/config/env.validation.ts` 为准。
- Worker 的 enabled、interval、batch 均纳入 Joi 校验；ConfigService 提供校验后的值，默认值与边界见第 4 节。

## 1) 数据库、连接串与索引治理

数据库按环境与测试用途使用独立 database 实现 database-level isolation；`browser_acceptance` 是独立数据库用途，不是新的 `NODE_ENV`：

| `NODE_ENV` | `EDUFORGE_DATABASE_PURPOSE` | Database |
|---|---|---|
| `development` | 不设置 | `eduforge_dev` |
| `test` | `standard_test`（未设置时默认） | `eduforge_test` |
| `test` | `browser_acceptance` | `eduforge_browser_test` |
| `production` | 不设置 | `eduforge` |

purpose 仅在 test 环境允许上述两个值；空值、未知值或非 test 环境声明 purpose 都被拒绝。

连接串与环境文件口径：

- `MONGO_URI` 是应用连接配置；`MONGO_ADMIN_URI` 是索引同步、导入、迁移等运维操作的连接配置。声明与实际 databaseName 必须符合上述映射；缺失或不匹配均 fail-closed，不回退到其他数据库。
- development/test 使用两类账号：`*_app` 用于应用运行，权限限于对应库 `readWrite`；`*_db_admin` 用于索引同步、导入、迁移等人工/脚本操作。当前 production 的 `MONGO_URI` 与 `MONGO_ADMIN_URI` 使用相同连接串和 `root` 账号。
- 普通后端环境配置来源按优先级为 `.env.<NODE_ENV>`、`.env`；tracked example 与各环境配置组合见第 3 节，真实 `.env*` 是 ignored 本机配置，不得提交。

Browser acceptance 配置：

- `backend/.env.browser-acceptance` 是本机 ignored 文件，tracked 模板为 `backend/.env.browser-acceptance.example`；仅含 `EDUFORGE_DATABASE_PURPOSE`、`BROWSER_ACCEPTANCE_APP_MONGO_URI` 和 `BROWSER_ACCEPTANCE_ADMIN_MONGO_URI`。
- APP URI 对应应用的 `MONGO_URI`；ADMIN URI 是管理角色配置，不注入 Nest 应用连接；APP/ADMIN URI 必须不同。
- Browser backend 的固定网络配置为 `127.0.0.1`、CORS origin `http://localhost:3000`；`BACKEND_PORT` 默认 `5000`，是唯一允许 shell 覆写的配置项。AI/Mail 配置组合见第 3 节。
- Browser acceptance 使用独立 purpose 与 APP/ADMIN URI 配置；具体 process roles、启动门禁、环境隔离、连接核验及 fixture/verifier 边界见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md)。

索引与 `autoIndex`：

| `NODE_ENV` | Mongoose `autoIndex` |
|---|---|
| `development` | `true` |
| `test` | `true` |
| `production` | `false` |

- production 的 Schema 索引同步唯一入口是 `npm run sync-indexes`；不得依赖 production 启动时 `autoIndex` 建索引。
- `sessions` 集合必须具备 `userId_1`、`token_1 unique`、`expiresAt_1 expireAfterSeconds:0`。

## 2) Cookie、CORS 与前端代理

- 会话 Cookie：`ef_session`，`HttpOnly=true`、`sameSite=lax`、`secure=(NODE_ENV=production)`、`path=/`、`maxAge=SESSION_TTL_MS`（当前 `7d`）。
- 后端 CORS origin 由 `FRONTEND_URL` 控制，默认 `http://localhost:3000`。
- `FRONTEND_BACKEND_ORIGIN` 是 frontend BFF 的 server-side upstream origin。
- 本地开发模板：`frontend/.env.local.example` → 实际 `frontend/.env.local`，值为 `http://localhost:5000`。
- 生产模板：`frontend/.env.production.example` → 实际 `frontend/.env.production`，值为 `http://127.0.0.1:5000`。
- 本地 `localhost` 强调开发可读性；生产 `127.0.0.1` 明确 Next.js server → 同机 NestJS backend 的 IPv4 loopback，避免 localhost 的 IPv4/IPv6 解析歧义，不代表 Browser 访问用户本机。两者地址字符串不同是有意设计。
- 实际 `.env.local`、`.env.production` 及其他真实 `.env*` 是机器配置，继续 Git ignored、不得提交；Git 仅跟踪上述两份 frontend example 模板。
- 正式业务访问使用同域 BFF；具体 proxy path、header forwarding、response passthrough、client 调用链及异常行为见 [Frontend API Map](./handoff-frontend-api-map.md)。

## 3) AI 开关职责与环境配置组合

- `AI_FEEDBACK_PROVIDER` 选择 AI Provider；`stub` 不触网，Key 条件见第 4 节。
- `AI_FEEDBACK_WORKER_ENABLED` 只控制后台自动消费，不是 AI 总开关；关闭 Worker 不禁用 Provider，也不禁止通过独立门禁的显式处理。
- `AI_FEEDBACK_DEBUG_ENABLED` 独立控制 debug/ops 能力是否启用。开关默认值与校验见第 4 节；具体 API 权限、门禁与错误行为由 [Backend API Map](./handoff-backend-api-map.md) 维护。
- Worker 与 Provider 的内部执行和日志行为见 [Backend Service Map](./handoff-backend-service-map.md)。

下表记录当前 tracked example / Browser 配置组合中的显式值；未显式配置的核心变量使用第 4 节默认值。真实文件继续 ignored，不在本文记录密钥。

| 环境 / purpose | 配置来源 | `AI_FEEDBACK_PROVIDER` | `AI_FEEDBACK_WORKER_ENABLED` | `MAIL_PROVIDER` | 其它配置事实 |
|---|---|---|---|---|---|
| development | `backend/.env.development.example` | `bailian` | `true` | `smtp` | 本地真实集成配置；显式 `BAILIAN_MODEL=qwen3.6-plus`。 |
| standard_test | `backend/.env.test.example` | `stub` | `false` | `log` | Mail 示例仅配置 `MAIL_PROVIDER`。 |
| browser_acceptance | `backend/.env.browser-acceptance.example`，变量范围见第 1 节 | `stub` | `false` | `log` | 固定 `NODE_ENV=test`；不使用真实 AI Key 或 SMTP sender 配置。 |
| production | `backend/.env.production.example` | `bailian` | `true` | `smtp` | 显式 `BAILIAN_MODEL=qwen3.6-plus`；SMTP 配置来自 env。 |

Mock Bailian 等测试组合的执行方案见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md)，本节不维护测试 runner 或 mock server 操作步骤。

## 4) 核心 env 列表与默认值

本节集中维护核心默认值与静态校验；环境显式配置见第 3 节，护栏建议范围见第 6 节。

| 变量                                           | 默认值                                              | 来源                                                 | 说明                                                                            |
| ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | `development`                                       | Joi                                                  | `development`、`test`、`production`。 |
| `FRONTEND_URL`                                 | `http://localhost:3000`                             | Joi                                                  | CORS origin。                                                                   |
| `MAIL_PROVIDER` | `log` | Joi | 仅支持 `log`、`smtp`；环境组合见第 3 节。 |
| `MAIL_FROM` | 无 | Joi | 提供时必须为有效 email；必填条件见下文。 |
| `MAIL_FROM_NAME` | `EduForge` | Joi | SMTP 发件人显示名，可省略。 |
| `SMTP_HOST`                                    | 无                                                  | Joi                                                  | SMTP 主机；必填条件见下文。                                    |
| `SMTP_PORT`                                    | `465`                                               | Joi                                                  | SMTP 端口。                                                                     |
| `SMTP_SECURE`                                  | `true`                                              | Joi                                                  | SMTP 是否启用 TLS/SMTPS。                                                       |
| `SMTP_USER`                                    | 无                                                  | Joi                                                  | SMTP 用户名；必填条件见下文。                                  |
| `SMTP_PASS`                                    | 无                                                  | Joi                                                  | SMTP 密码；必填条件见下文，不得写入日志。                    |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS`            | `5000`                                              | Joi                                                  | Mongo 连接超时。                                                                |
| `AI_FEEDBACK_PROVIDER` | `stub` | Joi | Provider 选择：`stub`、`bailian`；Key 条件见下文。 |
| `AI_FEEDBACK_MAX_CODE_CHARS`                   | `12000`                                             | Joi                                                  | 发送给模型的代码截断上限；整数，范围 `500..200000`。                                                      |
| `AI_FEEDBACK_MAX_CONCURRENCY`                  | `2`                                                 | Joi                                                  | 进程级并发上限；整数，范围 `1..20`。                                                              |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30`                                                | Joi                                                  | 每 `classroomTaskId` 的本地软限流；整数，范围 `1..600`。                                             |
| `AI_FEEDBACK_AUTO_ON_SUBMIT`                   | `true`                                              | Joi                                                  | 提交后是否自动尝试创建 AI Job。                                                 |
| `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`       | `true`                                              | Joi                                                  | 自动入队是否仅限首提（attemptNo=1）。                                           |
| `AI_FEEDBACK_MAX_ITEMS`                        | `2`                                                 | Joi                                                  | 每次保存反馈条目上限；允许范围 `1..10`。                                        |
| `LEARNING_TASK_SUBMISSION_COOLDOWN_MS`         | `300000`                                            | Joi                                                  | 学生提交冷却窗口（ms）；按同一 student + classroomTask 判定，`0` 表示关闭冷却。 |
| `AI_FEEDBACK_DEBUG_ENABLED`                    | `false`                                             | Joi                                                  | debug/ops 配置开关；职责见第 3 节。                                                            |
| `AUTHZ_ENFORCE_ROLES`                          | `true`                                              | Joi                                                  | 角色校验配置开关。                                                    |
| `BAILIAN_API_KEY` | 无 | Joi | 真实 Provider Key；必填条件见下文。 |
| `BAILIAN_BASE_URL`                             | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Joi                                                  | 阿里云百炼大陆站 OpenAI-compatible 基础地址。                                   |
| `BAILIAN_MODEL`                                | `qwen-plus`                                         | Joi                                                  | 百炼模型名；环境显式配置见第 3 节。                        |
| `BAILIAN_TIMEOUT_MS`                           | `90000`                                             | Joi                                                  | 百炼上游超时（ms）；整数，`>=1000`。                                                            |
| `BAILIAN_MAX_RETRIES`                          | `1`                                                 | Joi                                                  | 百炼 provider 重试次数；整数，`>=0`。                                                        |
| `AI_FEEDBACK_WORKER_ENABLED` | `false` | Joi → ConfigService | 布尔值；后台自动消费开关，职责见第 3 节。 |
| `AI_FEEDBACK_WORKER_INTERVAL_MS` | `10000` | Joi → ConfigService | 后台自动消费间隔（ms），正整数。 |
| `AI_FEEDBACK_WORKER_BATCH_SIZE` | `5` | Joi → ConfigService | 后台自动消费批次大小，正整数。 |

条件必填与安全配置：

- `MAIL_PROVIDER=log` 不要求提供 `MAIL_FROM`、`MAIL_FROM_NAME` 或任何 `SMTP_*`。
- `MAIL_PROVIDER=smtp` 必须提供非空的 `MAIL_FROM`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`，缺失时静态校验拒绝配置；`MAIL_FROM_NAME`、`SMTP_PORT`、`SMTP_SECURE` 可省略。
- `AI_FEEDBACK_PROVIDER=bailian` 要求非空、非纯空白的 `BAILIAN_API_KEY`，缺失时静态校验拒绝配置；`stub` 不要求真实 Key。Worker 开关不影响此条件。
- 真实 SMTP 密码与 AI Key 只通过 env 提供，example 只保留占位符，不提交 secret。
- Mail 发送、transport 与日志行为由 [Backend Service Map](./handoff-backend-service-map.md) 维护。

## 5) AI 入队触发策略（attempt-based）组合语义

以下组合只控制提交后是否自动 enqueue，不改变已存在 Job 的执行配置。默认值见第 4 节。

| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | 自动入队配置效果 |
|---|---|---|
| `true` | `true` | 仅首提（attemptNo=1）自动入队；后续提交不自动入队。 |
| `true` | `false` | 每次提交都自动入队。 |
| `false` | 任意 | 不自动入队；不影响独立的手工入队方式。 |

未触发自动入队不表示配置异常；具体公开状态投影见 [DTO / Public Data Contract Cheatsheet](./handoff-backend-dto-cheatsheet.md)。

## 6) 护栏配置建议范围

下表仅维护配置级运维建议；变量默认值与合法范围统一见第 4 节，自动入队组合见第 5 节。

| 护栏项 | 变量 | 建议范围（交付运维） |
|---|---|---|
| 并发上限 | `AI_FEEDBACK_MAX_CONCURRENCY` | `2..6` |
| 软限流（按 classroomTask） | `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `20..120` |
| 单次落库上限 | `AI_FEEDBACK_MAX_ITEMS` | `1..2` |
| 百炼上游超时 | `BAILIAN_TIMEOUT_MS` | `60000..120000` |
| 百炼 provider 重试 | `BAILIAN_MAX_RETRIES` | `0..1` |
| 代码截断上限 | `AI_FEEDBACK_MAX_CODE_CHARS` | `8000..30000` |

选择 Bailian 真实 Provider 后，并发/限流/maxItems 会直接影响调用成本与上游压力。
