# 配置矩阵（Config Matrix）

## 0) 口径说明

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

连接串口径：

- 应用运行只读取 `MONGO_URI`；`DatabaseModule` 先核对 URI 声明的数据库，再核对连接后的实际 databaseName。两者必须符合上述映射；缺失或不匹配均 fail-closed，不回退到其他数据库。
- 运维脚本读取 `MONGO_ADMIN_URI`，包括 `npm run sync-indexes` 与 `npm run import-users -- ...`；脚本同样校验 databaseName。
- development/test 使用两类账号：`*_app` 用于应用运行，权限限于对应库 `readWrite`；`*_db_admin` 用于索引同步、导入、迁移等人工/脚本操作。当前 production 的 `MONGO_URI` 与 `MONGO_ADMIN_URI` 使用相同连接串和 `root` 账号。

Browser backend 配置与唯一启动入口：

- `backend/.env.browser-acceptance` 是本机 ignored 文件，模板为同构的 `.env.browser-acceptance.example`；仅含 `EDUFORGE_DATABASE_PURPOSE`、`BROWSER_ACCEPTANCE_APP_MONGO_URI` 和 `BROWSER_ACCEPTANCE_ADMIN_MONGO_URI`。
- `npm run start:browser-test` 执行 `backend/scripts/start-browser-test-backend.ts`。launcher 只解析该固定文件，先验证 purpose 与 APP/ADMIN 的数据库声明，再导入 AppModule；AppModule 在 Browser purpose 下 `ignoreEnvFile=true`，不加载 `.env.test` 或 `.env`。
- APP URI 映射为应用的 `MONGO_URI`。ADMIN URI 仅做不连接数据库的声明校验，不注入应用环境、不用作 Nest 连接；APP/ADMIN URI 必须不同。后续 fixture/admin 操作不属于此入口。
- launcher 清除继承的数据库、邮件、AI 等应用配置；固定 `NODE_ENV=test`、`MAIL_PROVIDER=log`（不注入 synthetic MAIL_FROM、不依赖 sender/SMTP 配置）、AI stub 且 real/worker 关闭。仅允许 shell `BACKEND_PORT` 覆写监听端口（默认 5000），绑定 `127.0.0.1`，CORS origin 为 `http://localhost:3000`。
- Browser 连接只尝试一次，连接后再次核对实际数据库，再 listen；启动输出只包含安全状态，不输出原始数据库/配置错误。普通 development/test/production 仍保留原有 `.env.<NODE_ENV>`、`.env` 加载顺序及连接重试策略。
- 普通入口和 Browser 入口共用 `configureApp()`：global prefix、CORS、cookie parser、ValidationPipe 与 AllExceptionsFilter 保持一致。Browser DB foundation 的验收与 fixture 边界见 [Backend testing playbook](./handoff-backend-testing-playbook.md)。

索引与 `autoIndex`：

| `NODE_ENV` | Mongoose `autoIndex` |
|---|---|
| `development` | `true` |
| `test` | `true` |
| `production` | `false` |

- production 的 Schema 索引同步唯一入口是 `npm run sync-indexes`；不得依赖 production 启动时 `autoIndex` 建索引。
- `sessions` 集合必须具备 `userId_1`、`token_1 unique`、`expiresAt_1 expireAfterSeconds:0`；SessionService 会在模块初始化时确保 session 索引存在。

## 2) Cookie、CORS 与前端代理

- 会话 Cookie：`ef_session`，`HttpOnly=true`、`sameSite=lax`、`secure=(NODE_ENV=production)`、`path=/`、`maxAge=SESSION_TTL_MS`（当前 `7d`）。
- 后端 CORS origin 由 `FRONTEND_URL` 控制，默认 `http://localhost:3000`。
- `FRONTEND_BACKEND_ORIGIN` 是 frontend BFF 的 server-side upstream origin。
- 本地开发模板：`frontend/.env.local.example` → 实际 `frontend/.env.local`，值为 `http://localhost:5000`。
- 生产模板：`frontend/.env.production.example` → 实际 `frontend/.env.production`，值为 `http://127.0.0.1:5000`。
- 本地 `localhost` 强调开发可读性；生产 `127.0.0.1` 明确 Next.js server → 同机 NestJS backend 的 IPv4 loopback，避免 localhost 的 IPv4/IPv6 解析歧义，不代表 Browser 访问用户本机。两者地址字符串不同是有意设计。
- 实际 `.env.local`、`.env.production` 及其他真实 `.env*` 是机器配置，继续 Git ignored、不得提交；Git 仅跟踪上述两份 frontend example 模板。
- 正式业务访问使用同域 BFF；具体 proxy path、header forwarding、response passthrough、client 调用链及异常行为见 [Frontend API Map](./handoff-frontend-api-map.md)。

## 3) 运行模式矩阵（最小可运维闭环）

- `AI_FEEDBACK_PROVIDER` 决定 Provider：`stub` 不触网、无需真实 API Key；`bailian` 对应真实百炼 Provider。
- 真实 AI 最小配置：`AI_FEEDBACK_PROVIDER=bailian` + 非空 `BAILIAN_API_KEY`。
- development example 定位为本地真实集成开发环境：`AI_FEEDBACK_PROVIDER=bailian`、`AI_FEEDBACK_WORKER_ENABLED=true`、显式 `BAILIAN_MODEL=qwen3.6-plus`，Mail 使用 `smtp`。
- `AI_FEEDBACK_WORKER_ENABLED` 只控制后台常驻 Worker 自动消费 AiFeedbackJob，不是“是否开启 AI”的总开关；`false` 不禁止 Provider 或显式 `process-once`。后台自动消费需另外设为 `true`。
- test example 显式保持 `provider=stub` / worker disabled；Browser acceptance example 说明 launcher 固定使用同样配置，仅读取用途与 APP/ADMIN 连接声明。

| 模式                       | 执行方式       | 目标                          | 必要 env                                                                                                                                                                                         | 可选 env（默认）                                                                                                                                                                                                 | 备注                                                                                                |
| -------------------------- | -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Stub                       | `worker`       | 本地开发/不触网，后台持续消费 | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_WORKER_ENABLED=true`                                                                                    | `AI_FEEDBACK_WORKER_INTERVAL_MS=10000`、`AI_FEEDBACK_WORKER_BATCH_SIZE=5`（Joi 正式默认）                                                                                                             | 默认不触发外部 AI。                                                                                 |
| Stub                       | `process-once` | 本地排障，一次性处理一批      | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_DEBUG_ENABLED=true`                                                                                     | `AI_FEEDBACK_WORKER_ENABLED=false`                                                                                                                                                                               | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`（不是 `403`）。 |
| Mock Bailian（E2E）     | `worker`       | CI/联调仿真 real provider     | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=bailian`、`BAILIAN_API_KEY=test-key`、`BAILIAN_BASE_URL=http://127.0.0.1:<port>`、`AI_FEEDBACK_WORKER_ENABLED=true` | `BAILIAN_MODEL=qwen-plus`、`BAILIAN_TIMEOUT_MS=90000`、`BAILIAN_MAX_RETRIES=1`、worker 两项同上                                                                                                   | 可配本地 mock server。                                                                              |
| Mock Bailian（E2E）     | `process-once` | CI/联调排障，一次性处理       | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=bailian`、`BAILIAN_API_KEY=test-key`、`BAILIAN_BASE_URL=http://127.0.0.1:<port>`、`AI_FEEDBACK_DEBUG_ENABLED=true`  | 同 mock Bailian 默认项                                                                                                                                                                                        | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`。               |
| Real Bailian（阿里云百炼） | `worker`       | 真实上游持续消费              | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=bailian`、`BAILIAN_API_KEY=<real>`、`AI_FEEDBACK_WORKER_ENABLED=true`                                                        | `BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`BAILIAN_MODEL=qwen-plus`（代码默认；生产可显式指定 `qwen3.6-plus`）、`BAILIAN_TIMEOUT_MS=90000`、`BAILIAN_MAX_RETRIES=1`、worker 两项同上 | 走 OpenAI Chat Completions 兼容接口；缺 key 会在 env 校验阶段 fail-fast。                           |
| Real Bailian（阿里云百炼） | `process-once` | 真实上游手工批处理排障        | `MONGO_URI`、`AI_FEEDBACK_PROVIDER=bailian`、`BAILIAN_API_KEY=<real>`、`AI_FEEDBACK_DEBUG_ENABLED=true`                                                         | `BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`BAILIAN_MODEL=qwen-plus`（代码默认；生产可显式指定 `qwen3.6-plus`）                                                                       | 调 `POST /api/learning-tasks/ai-feedback/jobs/process-once`；debug 关闭时返回 `404`。               |

补充门禁说明：

- `process-once` 属于 debug/ops 门禁路由：需登录 + RBAC（teacher）+ `AI_FEEDBACK_DEBUG_ENABLED=true`；否则按现实现返回 `404`。
- `POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` 是产品能力，不依赖 debug 门禁；但依赖登录 + RBAC + 资源归属校验。

## 4) 核心 env 列表与默认值

| 变量                                           | 默认值                                              | 来源                                                 | 说明                                                                            |
| ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | `development`                                       | Joi                                                  | `development`、`test`、`production`。 |
| `FRONTEND_URL`                                 | `http://localhost:3000`                             | Joi                                                  | CORS origin。                                                                   |
| `MAIL_PROVIDER` | `log` | Joi | 仅支持 `log`、`smtp`；test 示例使用 `log`，development/production 示例使用 `smtp`。 |
| `MAIL_FROM` | 无 | Joi | 仅 `smtp` 必填；`log` 可省略；提供时必须为有效 email。 |
| `MAIL_FROM_NAME` | `EduForge` | Joi | 可省略；仅 `smtp` 使用，组装为 `"MAIL_FROM_NAME" <MAIL_FROM>`。 |
| `SMTP_HOST`                                    | 无                                                  | Joi                                                  | SMTP 主机；`MAIL_PROVIDER=smtp` 时必须存在。                                    |
| `SMTP_PORT`                                    | `465`                                               | Joi                                                  | SMTP 端口。                                                                     |
| `SMTP_SECURE`                                  | `true`                                              | Joi                                                  | SMTP 是否启用 TLS/SMTPS。                                                       |
| `SMTP_USER`                                    | 无                                                  | Joi                                                  | SMTP 用户名；`MAIL_PROVIDER=smtp` 时必须存在。                                  |
| `SMTP_PASS`                                    | 无                                                  | Joi                                                  | SMTP 密码；`MAIL_PROVIDER=smtp` 时必须存在，且不得写入日志。                    |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS`            | `5000`                                              | Joi                                                  | Mongo 连接超时。                                                                |
| `AI_FEEDBACK_PROVIDER` | `stub` | Joi | Provider 选择：`stub`、`bailian`；真实 Provider 必须提供对应 Key。 |
| `AI_FEEDBACK_MAX_CODE_CHARS`                   | `12000`                                             | Joi                                                  | 发送给模型的代码截断上限。                                                      |
| `AI_FEEDBACK_MAX_CONCURRENCY`                  | `2`                                                 | Joi                                                  | 进程级并发信号量。                                                              |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30`                                                | Joi                                                  | 每 `classroomTaskId` 的本地软限流。                                             |
| `AI_FEEDBACK_AUTO_ON_SUBMIT`                   | `true`                                              | Joi                                                  | 提交后是否自动尝试创建 AI Job。                                                 |
| `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY`       | `true`                                              | Joi                                                  | 自动入队是否仅限首提（attemptNo=1）。                                           |
| `AI_FEEDBACK_MAX_ITEMS`                        | `2`                                                 | Joi                                                  | 每次保存反馈条目上限；允许范围 `1..10`。                                        |
| `LEARNING_TASK_SUBMISSION_COOLDOWN_MS`         | `300000`                                            | Joi                                                  | 学生提交冷却窗口（ms）；按同一 student + classroomTask 判定，`0` 表示关闭冷却。 |
| `AI_FEEDBACK_DEBUG_ENABLED`                    | `false`                                             | Joi                                                  | debug/ops 路由门禁。                                                            |
| `AUTHZ_ENFORCE_ROLES`                          | `true`                                              | Joi                                                  | 是否强制 `RolesGuard` 执行。                                                    |
| `BAILIAN_API_KEY` | 无 | Joi | 选择 `bailian` 时必填，不能是空值或纯空白。 |
| `BAILIAN_BASE_URL`                             | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Joi                                                  | 阿里云百炼大陆站 OpenAI-compatible 基础地址。                                   |
| `BAILIAN_MODEL`                                | `qwen-plus`                                         | Joi                                                  | 百炼模型名；生产可显式指定 `qwen3.6-plus` 或后续新版本。                        |
| `BAILIAN_TIMEOUT_MS`                           | `90000`                                             | Joi                                                  | 百炼上游超时（ms）。                                                            |
| `BAILIAN_MAX_RETRIES`                          | `1`                                                 | Joi                                                  | 百炼 provider 重试次数。                                                        |
| `AI_FEEDBACK_WORKER_ENABLED` | `false` | Joi → ConfigService | 布尔值；`true` 才启动常驻轮询，不控制显式处理。 |
| `AI_FEEDBACK_WORKER_INTERVAL_MS` | `10000` | Joi → ConfigService | 轮询间隔（ms），正整数；非法值拒绝启动。 |
| `AI_FEEDBACK_WORKER_BATCH_SIZE` | `5` | Joi → ConfigService | 每 tick 批次，正整数；非法值拒绝启动。 |

条件必填：

- `MAIL_PROVIDER=log` 不要求提供 `MAIL_FROM`、`MAIL_FROM_NAME` 或任何 `SMTP_*`；MailService 不读取或构造 sender，不创建 Nodemailer transport，不发送真实邮件。
- `MAIL_PROVIDER=smtp` 必须提供 `MAIL_FROM`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`；缺失会在 env 校验或 MailService 初始化阶段 fail-fast。`MAIL_FROM_NAME`、`SMTP_PORT`、`SMTP_SECURE` 可省略，默认值见上表。
- 当 `AI_FEEDBACK_PROVIDER=bailian` 时，`BAILIAN_API_KEY` 必须存在且非空、非纯空白；否则 env validation fail-fast。
- `stub` 不要求真实 API Key；Worker 开关不影响上述校验。Provider Base 保留 `MISSING_API_KEY` 运行时防御。

补充：

- log provider 只记录 `provider=log`、收件人 `to` 和主题 `subject`；不记录 text/HTML 正文、password reset URL、query token 或 reset token。test 示例的 Mail 配置仅保留 `MAIL_PROVIDER=log`。
- 生产真实发信使用 `MAIL_PROVIDER=smtp`，SMTP 配置全部来自 env；仓库示例文件只保留占位符，不提交真实密码。

PowerShell 本地百炼联调口径：

```powershell
$env:AI_FEEDBACK_PROVIDER="bailian"
$env:AI_FEEDBACK_WORKER_ENABLED="true"
$env:BAILIAN_API_KEY_REAL="你的百炼Key"
$env:BAILIAN_API_KEY = $env:BAILIAN_API_KEY_REAL
$env:BAILIAN_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:BAILIAN_MODEL="qwen3.6-plus"
```

## 5) AI 入队触发策略（attempt-based）组合语义

说明：

- 仅影响“Submission 创建后是否自动创建 AI Job（enqueue）”的触发层行为。
- 不影响执行层（worker/processor/provider）对“已存在 Job”的消费与处理。

| `AI_FEEDBACK_AUTO_ON_SUBMIT` | `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` | 行为                                                                   |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `true`                       | `true`                                   | 仅首提（attemptNo=1）自动入队；后续提交默认不入队（`NOT_REQUESTED`）。 |
| `true`                       | `false`                                  | 每次提交都自动入队（保持旧行为）。                                     |
| `false`                      | 任意                                     | 不自动入队；只能通过产品级手工 request 创建 Job。                      |

补充：

- 当后续提交未自动入队时，“无 Job”是策略结果，应体现为 `NOT_REQUESTED`，不代表系统异常。
- “无 job => NOT_REQUESTED” 是正常产品语义，适用于 dashboards / `my-task-detail` / `learning-trajectory` 等聚合视图。

## 6) Worker / Debug 默认关闭与开启方式

默认关闭：

- `AI_FEEDBACK_WORKER_ENABLED=false`。
- `AI_FEEDBACK_DEBUG_ENABLED=false`。

开启方式（PowerShell）：

```powershell
cd backend
$env:AI_FEEDBACK_WORKER_ENABLED="true"
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
npm run start:dev
```

关闭恢复：

```powershell
Remove-Item Env:AI_FEEDBACK_WORKER_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:AI_FEEDBACK_DEBUG_ENABLED -ErrorAction SilentlyContinue
```

最小排障路径：

- 不开 worker 时，可用 `POST /api/learning-tasks/ai-feedback/jobs/process-once` 手动处理一批（受 debug 门禁）。
- 不开 debug 时，`process-once` 路由返回 `404` 属正常；此时只能开 worker，或走产品手工 request（`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request`）后等待 worker 消费。

debug/ops 门禁口径（与当前实现一致）：

- 全局 `SessionAuthGuard`（`APP_GUARD`）负责非 `@Public()` 路由登录态校验。
- debug/ops 路由显式 `@UseGuards(AiFeedbackDebugEnabledGuard, RolesGuard)`，即先 debug 门禁，再 RBAC。
- 当 `AI_FEEDBACK_DEBUG_ENABLED=false` 时，teacher/admin 访问 debug/ops 优先返回 `404`。

## 7) 护栏 env（默认值 + 建议范围）

提示：本节为“执行层护栏”（processor/provider）；触发层入队策略见第 5 节。

| 护栏项                     | 变量                                           | 默认值  | 约束范围（源码） | 建议范围（交付运维） |
| -------------------------- | ---------------------------------------------- | ------- | ---------------- | -------------------- |
| 并发信号量                 | `AI_FEEDBACK_MAX_CONCURRENCY`                  | `2`     | `1..20`          | `2..6`               |
| 软限流（按 classroomTask） | `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30`    | `1..600`         | `20..120`            |
| 单次落库上限               | `AI_FEEDBACK_MAX_ITEMS`                        | `2`     | `1..10`          | `1..2`               |
| 百炼上游超时               | `BAILIAN_TIMEOUT_MS`                           | `90000` | `>=1000`         | `60000..120000`      |
| 百炼 provider 重试         | `BAILIAN_MAX_RETRIES`                          | `1`     | `>=0`            | `0..1`               |
| 代码截断上限               | `AI_FEEDBACK_MAX_CODE_CHARS`                   | `12000` | `500..200000`    | `8000..30000`        |

补充（worker 专属；三项均由 Joi 校验并通过 ConfigService 读取，非法值不再由 Worker fallback）：

- `AI_FEEDBACK_WORKER_ENABLED`：默认 `false`，控制是否启动常驻轮询。
- `AI_FEEDBACK_WORKER_INTERVAL_MS`：默认 `10000`，控制每次轮询间隔。
- `AI_FEEDBACK_WORKER_BATCH_SIZE`：Joi 正式默认 `5`，控制每次 tick 处理数量。
- 空跑 tick（processed/succeeded/failed/dead 全 0）默认不输出结果 DEBUG 日志；仅非空跑保留结果日志。
- `LEARNING_TASK_SUBMISSION_COOLDOWN_MS`：默认 `300000`，控制学生提交冷却窗口（同一 `studentId + classroomTaskId`）；`0` 表示关闭冷却。

成本提醒：

- 选择 Bailian 真实 Provider 后，并发/限流/maxItems 会直接影响调用成本与上游压力。
