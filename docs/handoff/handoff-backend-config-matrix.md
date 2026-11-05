# 配置矩阵（Config Matrix）

## 0) 口径说明

- 本矩阵只维护配置入口、默认值与静态校验、环境映射及运行模式等当前配置事实；配置项、开关或运行模式存在，不等于对应 Service、route 或产品能力已经实现，也不代表测试资产已存在或证据已通过。当前实现能力与真实未实现边界见 [Backend Snapshot](./handoff-backend-snapshot.md)、[Frontend Snapshot](./handoff-frontend-snapshot.md) 及当前代码；测试资产、执行能力与证据状态见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 和 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)。
 - env 默认值以 `backend/src/config/env.validation.ts` 为准。
- Worker 的 enabled、interval、batch 均纳入 Joi 校验；ConfigService 提供校验后的值，默认值与边界见第 4 节。

## 1) 数据库、连接串与索引治理

数据库兼容目标为 MongoDB 9.0.4（本地）与 8.3（服务器），使用同一套后端依赖；Mongoose 及其实际 MongoDB Node.js Driver 版本以 `backend/package-lock.json` 为准。选择驱动时核对 [MongoDB 官方兼容矩阵](https://www.mongodb.com/docs/drivers/compatibility/?driver-language=javascript&javascript-driver-framework=nodejs) 对两个 Server 主版本及 Node.js 24 的支持，不通过 `overrides` 强行替换 Mongoose 的驱动。官方支持范围、纯测试与构建结果不等于两个实际环境的业务回归已通过；真实数据库回归须遵守 Testing Playbook 的隔离边界，不以生产库作为升级测试靶场。

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

- production 的 Schema 索引同步唯一入口为 [sync-indexes 普通模式](#sync-indexes-普通索引同步) 的显式 apply。应用启动时保持 `autoIndex=false`。
- `sessions` 集合必须具备 `userId_1`、`token_1 unique`、`expiresAt_1 expireAfterSeconds:0`。

### sync-indexes 普通索引同步

在 `backend` 目录运行。执行前按 [数据库治理规范](../database-conventions.md#4-索引同步与受控流程) 核对目标环境、库名、运维权限、变更范围和恢复方案。

```text
npm run sync-indexes -- --help
npm run sync-indexes
npm run sync-indexes -- --dry-run
npm run sync-indexes -- --apply --confirm-db <精确库名>
npm run sync-indexes -- --apply --confirm-db <精确库名> --allow-drop
```

- 无参数等价于只读 `--dry-run`，`--help` 独立于环境配置和数据库连接。CLI 拒绝未知、重复和冲突参数。普通执行要求调用进程显式设置 `NODE_ENV` 为 `development`、`test` 或 `production`。文件来源仅为对应的 `backend/.env.<NODE_ENV>`，以显式进程 `MONGO_ADMIN_URI` 优先。显式空值、非法 purpose 或任一来源声明 `browser_acceptance` 均拒绝。所选文件缺失且进程配置足够时可继续。连接前校验 URI 声明库名，连接后校验实际库名。
- 独立 Mongoose 连接和正式模型 Schema 克隆均禁用自动建集合和索引。CLI 按主节点读取，拒绝有效的 `directConnection=true`；apply 额外拒绝有效的 `w=0`。独立连接固定 `raw: false`，与原生索引游标均使用 `promoteValues: true`、`promoteLongs: true`、`useBigInt64: false`。原生索引盘点开启 `includeBuildUUIDs`，使用有界游标期限，结束后关闭游标和连接。
- 先用 `--dry-run` 审阅。apply 重新生成并输出本次完整计划，包含待建集合、待删索引的原始定义和待建索引定义，只有精确库名确认通过才进入写入阶段。含删除的计划必须同传 `--allow-drop`。逐模型执行前用集合 UUID 与原始计划复查目标，按冻结计划逐项等待删建。首个写前检查或 DDL 错误即停止后续写入。后续模型发生漂移时，前面操作可能已完成。
- 每个阶段读取集合存在性、类型、默认 collation 和 `info.uuid`。只接受普通集合及默认 simple collation，已存在的集合须有合法 UUID。新建集合后立即记录 UUID 作为最终验收的身份基线。构建中、全文、`hidden: true`、`prepareUnique: true` 和不支持的键方向仍拒绝。复合键含会被 JS 对象重新排序的字段，或待建索引名称已被保留索引占用时，预检拒绝。UUID 复查用于发现读到的同名集合替换，检查与实际写入之间仍有竞争窗口。
- 计划和写前复查基于各阶段同一份原生索引盘点。Mongoose `diffIndexes()` 使用比较副本，沿用 `sparse: false` 与缺省等价。部分过滤器仅支持两个精确等价规则。顶层普通文档须只含自有键 `classroomTaskId`，值可以是 `null` 或仅含 `$eq: null` 的普通文档，也可以是仅含 `$type: 'objectId'` 或 `$type: 7` 的普通文档。这里的 `7` 必须为 JS number。附加谓词和其他表达式继续按原定义比较。计划、原始定义及结果使用 Canonical Extended JSON；比较归一化只作用于副本。
- 进入 apply 后统一在末尾重新读取本次计划的全部模型，逐项检查实际定义与正式 Schema，包括有序键、唯一性、TTL、sparse、当前部分过滤器、collation、特殊状态和显式索引名称。默认索引须同时满足名称 `_id_` 与键 `{ _id: 1 }`，元数据可以省略 `unique: true`。额外索引（包括 `_id_hashed`）列入剩余差异。各模型独立报告验收通过、有差异或无法确认。验收只读，单项失败后继续检查其他模型。
- 输出分别报告操作完成、失败、未执行及各模型验收结果。命令成功后的终态差异可能到末尾才发现。执行错误保留，即使最终定义恰好达标也退出非零；验收差异、无法确认或关闭连接失败亦退出非零。超时后服务端仍可能完成 DDL，由操作者依据回读结果决定后续定向修复。
- 同库集合和索引维护串行进行。替换唯一索引前暂停相关业务写入，删建分步执行期间可能出现约束空窗。TTL 变更可影响文档的自动过期。测试口径见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md#sync-indexes-定向验收)。

### import-users 独立导入 CLI

- 正式入口为 `npm run import-users`，保留 `--file`、`--dry-run`、`--reset-password`；`--help` 不要求环境、CSV 文件或数据库连接。
- 正常执行先检查调用进程原始 `NODE_ENV`，只接受 `development`、`test`、`production`，不得由环境文件或默认值补齐。随后仅读取对应的 `backend/.env.<NODE_ENV>`；显式进程 `MONGO_ADMIN_URI` 优先于该文件，不叠加通用 `.env`，不回退 `MONGO_URI`，不改写 `process.env.MONGO_URI`，环境文件也不能改变已选定的 `NODE_ENV`。
- 数据库映射与 purpose 合法性沿用本节权威定义；本 CLI 不支持 `browser_acceptance`，进程或所选文件声明该用途均拒绝。连接前精确校验管理 URI 的库名，连接后先核对实际 `databaseName`，通过后才建立模型和查询用户；不要求 AI、SMTP 等无关配置。
- 使用独立 Mongoose 连接，明确 `autoCreate=false`、`autoIndex=false`，复用现有 Schema，不启动 AppModule、认证模块、Worker 或 Provider，不显式调用 `init`、`ensureIndexes`、`syncIndexes`、`createCollection` 等初始化写入入口。成功、失败及实际库名不符时均回收本轮连接。
- `--dry-run` 可以读取目标库现有用户以计算**预计**创建、更新、跳过和失败数量；不创建或修改用户、不生成密码哈希、不撤销凭据、不处理作业、不调用模型或发送邮件。预计统计不是实际写入结果；离线测试与真实数据库验收的证据边界见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md#import-users-定向离线回归)。
- 默认不修改已有账号密码；`--reset-password` 在已有用户密码更新成功且确认匹配后，删除该 `userId` 的**全部会话**，并作废其尚未使用且未过期的密码重置令牌。撤销影响零条记录属于正常结果，用户文档未变化也不能跳过撤销；两项撤销均须尝试，任一失败或写入未确认时该行只计一次失败，不计更新成功。密码更新失败或未匹配时不继续撤销；再次显式重置仍执行完整更新与撤销流程。
- 保留逐行部分成功语义，不使用整批事务；失败可能已经部分生效，不回滚、不自动重试。任一行失败或致命启动、连接、关闭错误均以非零状态退出，不把部分成功报告为全部完成。

### Task.stage 定向退役运维

用户已确认 `Task.stage` 迁移完成。一次性运维入口已移除，原实现可从 Git 历史查阅。

历史恢复材料的归档路径为项目根目录下的 `.local/deliverables/task-stage-retirement-backups/<本轮标识>/<库名>/`，已有备份应继续保留。

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
- `AI_FEEDBACK_DUMP_REQUEST_BODY` 独立控制请求体、响应与合并过程的本地诊断留存，不依赖 debug/ops 开关；沿用现有开关，使用方式见下文。
- Worker 与 Provider 的内部执行和日志行为见 [Backend Service Map](./handoff-backend-service-map.md)。

下表记录当前 tracked example / Browser 配置组合中的显式值；未显式配置的核心变量使用第 4 节默认值。真实文件继续 ignored，不在本文记录密钥。

| 环境 / purpose | 配置来源 | `AI_FEEDBACK_PROVIDER` | `AI_FEEDBACK_WORKER_ENABLED` | `MAIL_PROVIDER` | 其它配置事实 |
|---|---|---|---|---|---|
| development | `backend/.env.development.example` | `bailian` | `true` | `smtp` | 本地真实集成配置；显式 `BAILIAN_MODEL=qwen3.6-plus`。 |
| standard_test | `backend/.env.test.example` | `stub` | `false` | `log` | Mail 示例仅配置 `MAIL_PROVIDER`。 |
| browser_acceptance | `backend/.env.browser-acceptance.example`，变量范围见第 1 节 | `stub` | `false` | `log` | 固定 `NODE_ENV=test`；不使用真实 AI Key 或 SMTP sender 配置。 |
| production | `backend/.env.production.example` | `bailian` | `true` | `smtp` | 显式 `BAILIAN_MODEL=qwen3.6-plus`；SMTP 配置来自 env。 |

Mock Bailian 等测试组合的执行方案见 [Backend Testing Playbook](./handoff-backend-testing-playbook.md)，本节不维护测试 runner 或 mock server 操作步骤。

### 实际发送边界请求体留存

`AI_FEEDBACK_DUMP_REQUEST_BODY` 经 Joi 校验后以布尔值读取，默认值见第 4 节。只有 `NODE_ENV === "development"` 且该值严格为 `true` 时启用；`test`（含 `browser_acceptance`）和 `production` 即使配置为 true 也不留存。关闭或运行环境不允许时，不访问文件系统、不创建目录。

固定输出目录为 `<仓库根目录>/.local/deliverables/ai-feedback-requests/`；原请求仍写 `<stem>.json`，同次调用的响应与合并诊断分别写 `diagnostics/<stem>.response.json`、`diagnostics/<stem>.compaction.json`。三者共享由安全化 submissionId、Windows 合法时间戳及 UUID 组成的 stem，以独占创建（`wx`）防止覆盖；各文件独立保存，不能因缺少某一文件推定其余阶段未执行。

根定位兼容源码和正常 `backend/dist/src` 布局，不依赖启动 cwd，也不增加路径配置项。目录沿用根 `.gitignore` 的 `/.local/deliverables/` 忽略规则；诊断可含完整学生材料和供应商响应，不作为 Git 跟踪资产。

在本地开发配置中显式设置 `AI_FEEDBACK_DUMP_REQUEST_BODY=true`，重启后端后生效；设回 false 或移除后也须重启，不提供动态切换。发送、文件内容及失败边界由 [Provider Card B](./handoff-backend-service-map.md#provider-card-b) 维护。

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
| `AI_FEEDBACK_MAX_INPUT_BYTES` | `65536` | Joi / Provider fallback | 完整 system/user messages 序列化 UTF-8 字节限额；整数 `16384..262144`，不是准确 Token 或金额预算。 |
| `AI_FEEDBACK_MAX_OUTPUT_TOKENS` | `2048` | Joi / Provider fallback | 上游 max_tokens；整数 `256..4096`。 |
| `AI_FEEDBACK_MAX_CONCURRENCY`                  | `2`                                                 | Joi                                                  | 进程级并发上限；整数，范围 `1..20`。                                                              |
| `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `30`                                                | Joi                                                  | 每 `classroomTaskId` 的本地软限流；整数，范围 `1..600`。                                             |
| `AI_FEEDBACK_MAX_ITEMS`                        | `2`                                                 | Joi                                                  | 每次保存反馈条目上限；允许范围 `1..10`。                                        |
| `LEARNING_TASK_SUBMISSION_COOLDOWN_MS`         | `300000`                                            | Joi                                                  | 学生提交冷却窗口（ms）；按同一 student + classroomTask 判定，`0` 表示关闭冷却。 |
| `AI_FEEDBACK_DEBUG_ENABLED`                    | `false`                                             | Joi                                                  | debug/ops 配置开关；职责见第 3 节。                                                            |
| `AI_FEEDBACK_DUMP_REQUEST_BODY` | `false` | Joi → ConfigService | 布尔值；仅显式 true 且 development 启用本地请求/响应/合并诊断，环境、目录和启停方式见第 3 节。 |
| `AUTHZ_ENFORCE_ROLES`                          | `true`                                              | Joi                                                  | 角色校验配置开关。                                                    |
| `BAILIAN_API_KEY` | 无 | Joi | 真实 Provider Key；必填条件见下文。 |
| `BAILIAN_BASE_URL`                             | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Joi                                                  | 阿里云百炼大陆站 OpenAI-compatible 基础地址。                                   |
| `BAILIAN_MODEL`                                | `qwen-plus`                                         | Joi                                                  | 百炼模型名；环境显式配置见第 3 节。                        |
| `BAILIAN_TIMEOUT_MS`                           | `90000`                                             | Joi                                                  | 百炼上游超时（ms）；整数，`>=1000`。                                                            |
| `AI_FEEDBACK_WORKER_ENABLED` | `false` | Joi → ConfigService | 布尔值；后台自动消费开关，职责见第 3 节。 |
| `AI_FEEDBACK_WORKER_INTERVAL_MS` | `10000` | Joi → ConfigService | 后台自动消费间隔（ms），正整数。 |
| `AI_FEEDBACK_WORKER_BATCH_SIZE` | `5` | Joi → ConfigService | 后台自动消费批次大小，正整数。 |

Bailian 固定使用非流式、请求体顶层 `enable_thinking:true` 与 `max_tokens`，不使用 extra_body 封装；无关闭思考的运行开关，不新增 `thinking_budget`、`reasoning_effort` 或第二套输出上限。`AI_FEEDBACK_MAX_OUTPUT_TOKENS`、`BAILIAN_TIMEOUT_MS` 的配置入口、默认值及范围均保持不变。

按[阿里云 OpenAI-compatible Chat Completions 参数定义](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)，当前 Qwen 调用的 `max_tokens` 限制回答长度，不包含思维链；`thinking_budget` 才是独立的思考过程长度参数，本项目不设置它。因此现有 `max_tokens` 不是思维链与回答的全部输出 Token 总限额。超时和 `finish_reason=length` 沿用原失败语义，不降级关闭思考，也不发起非思考重试；`content` / `reasoning_content` 隔离及 usage 计量职责沿用 [Provider Card B](./handoff-backend-service-map.md#provider-card-b)。

`AI_FEEDBACK_MAX_CODE_CHARS` 与 `BAILIAN_MAX_RETRIES` 已废止：移除校验、读取及 example，ignored env 残留不恢复截断或 Provider 重试。每 Job 最多三次处理机会，无新增次数配置，内部执行见 Service Owner。模型路由及默认值保持不变。

条件必填与安全配置：

- `MAIL_PROVIDER=log` 不要求提供 `MAIL_FROM`、`MAIL_FROM_NAME` 或任何 `SMTP_*`。
- `MAIL_PROVIDER=smtp` 必须提供非空的 `MAIL_FROM`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`，缺失时静态校验拒绝配置；`MAIL_FROM_NAME`、`SMTP_PORT`、`SMTP_SECURE` 可省略。
- `AI_FEEDBACK_PROVIDER=bailian` 要求非空、非纯空白的 `BAILIAN_API_KEY`，缺失时静态校验拒绝配置；`stub` 不要求真实 Key。Worker 开关不影响此条件。
- 真实 SMTP 密码与 AI Key 只通过 env 提供，example 只保留占位符，不提交 secret。
- Mail 发送、transport 与日志行为由 [Backend Service Map](./handoff-backend-service-map.md) 维护。

## 5) AI 请求与退役配置

AI Job 统一由有权师生正式手动申请，提交本身不触发入队。`AI_FEEDBACK_AUTO_ON_SUBMIT` 与 `AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY` 已退役，不再运行读取或 Joi 声明；真实环境中残留旧值不能恢复自动入队，不因此改变通用 unknown 配置策略或增加启动失败条件。产品授权见 [API Learning Tasks](./handoff-backend-api-map.md#learning-tasks)，公开状态见 [DTO / Public Data Contract Cheatsheet](./handoff-backend-dto-cheatsheet.md)。

## 6) 护栏配置建议范围

下表仅维护配置级运维建议；变量默认值与合法范围统一见第 4 节。

| 护栏项 | 变量 | 建议范围（交付运维） |
|---|---|---|
| 并发上限 | `AI_FEEDBACK_MAX_CONCURRENCY` | `2..6` |
| 软限流（按 classroomTask） | `AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE` | `20..120` |
| 单次落库上限 | `AI_FEEDBACK_MAX_ITEMS` | `1..2` |
| 百炼上游超时 | `BAILIAN_TIMEOUT_MS` | `60000..120000` |
| 完整输入字节限额 | `AI_FEEDBACK_MAX_INPUT_BYTES` | 根据课堂材料体积在静态边界内配置 |
| 上游输出上限 | `AI_FEEDBACK_MAX_OUTPUT_TOKENS` | 根据反馈长度在静态边界内配置 |

选择 Bailian 真实 Provider 后，并发/限流/maxItems 会直接影响调用成本与上游压力。


## 7) ZIP 资料资源

资源根固定为项目根 `.local`，与 backend/frontend 同级；读取服务按自身模块位置定位 source 与正常 `backend/dist/src` 产物，不依赖启动 cwd。不新增环境变量；集中代码常量为 `AI_CONTEXT_LIMITS`（`backend/src/modules/learning-tasks/ai-context/ai-context.types.ts`）。

| 资源读取保护 | 固定上限 |
|---|---|
| 每任务 ZIP 引用 | 8 |
| 全部 ZIP 选中文件 | 32 |
| 单 ZIP 物理大小 | 32 MiB |
| 单 ZIP 扫描条目 | 4096 |
| 单个选中文件声明/实际解压大小 | 64 KiB |
| 全部选中文件声明/实际解压总量 | 256 KiB |
| archivePath / 单 entryPath | 各 1024 字符 |

KiB/MiB 按 1024 进制。读取保护不替代 §4 完整 AI 输入预算，不提高默认预算、不截断或丢弃参考资料。

教材目录继续纳入 Git，每本教材独立目录；部署和运行须保留配置的精确包路径。新版本使用新文件名，已被实例引用的旧包继续保留；不自动搜索最新版、替换或补齐。快照固定引用路径，不防止维护者手工覆盖同名包；不新增文件版本数据库或正文快照。`.local` 不挂静态目录，引用配置不是下载授权。实际教材配置示例由 [DTO Owner](./handoff-backend-dto-cheatsheet.md#zip-资料引用配置) 维护。
