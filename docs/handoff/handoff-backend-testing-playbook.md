# EduForge 后端测试治理手册

## 1. Scope / Owner

本文是 EduForge backend test layers、真实 runner / command、Database Purpose、DB / process isolation、Browser backend APP / ADMIN role 与当前 backend test asset 事实的 Owner。通用验证候选生成、初始 / 增量 A/B/C、候选归属、完成治理与覆盖对账由 [Codex instruction spec](../codex-instruction-spec.md) §3.9 维护；本文不复制通用候选来源或完成合同。

通用 E2E 原则见 [E2E Testing](../e2e-testing.md)；数据库名、连接变量和运行模式的完整映射由 [Backend config matrix](./handoff-backend-config-matrix.md) 维护；前端测试、Browser evidence 与 smoke 由 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 维护。

本文不复制 API、DTO、Service 或配置明细，也不保存逐轮执行日志、覆盖率流水或完整 spec inventory。

## 2. Current Test Baseline

基于当前仓库资产，后端证据分层如下：

| 层级 | 当前资产与工具 | 主要证明语义 |
|---|---|---|
| Pure / Static | `npm run lint`、`npm run typecheck`、`npm run build` | lint、全量 TypeScript 类型检查、Nest 编译、import 与静态结构 |
| Unit / Service / Controller | `backend/src/**/*.spec.ts` + `backend/scripts/**/*.spec.ts`，Jest + ts-jest | Service 分支、Controller 参数传递、局部规则、mapper 与错误边界 |
| HTTP E2E / Integration | `backend/test/*.e2e-spec.ts`，Jest + Supertest | 真实 Nest HTTP、Guard/Pipe/DTO、Session、角色/ownership、MongoDB 终态与跨模块链路 |
| Scripted Browser | runner 由 frontend 维护；已存在 FT-02 BFF Cookie / BrowserContext non-UI micro-profile；后端已具备 Browser backend launcher 与 `browser_acceptance` database foundation | 不可由低层证明的 Browser-native 合同由前端 Owner 治理；该 profile 不证明产品 UI |
| Agent-assisted / Human smoke | 不属于后端自动测试 Owner | 真实产品 UI 可操作性与主观教学/UX 判断，见 Frontend testing playbook |

Unit 与 HTTP E2E 可以覆盖同一业务区域，但不得重复承担同一主断言：局部规则留在 unit，真实 HTTP/认证/数据库终态留在 E2E。

## 3. 最低充分证据选择

1. 纯函数、Service 分支、Controller 参数传递和廉价防御优先用 unit。
2. HTTP E2E 的项目级证明能力包括真实 Nest HTTP route、authentication / Session、authorization / role、Guard / Pipe、DTO whitelist、ownership、lifecycle / state gate、rejection semantics、非法调用无业务副作用，以及必要的 MongoDB 权威终态。
3. Risk Classification 定义采用 [Frontend testing playbook](./handoff-frontend-testing-playbook.md)，验证候选生成、风险必要性判断及风险到最低充分证据层的分配遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.9；本节只维护后端证据能力与跨层不重复证明边界，不另建 risk → evidence mapping。
4. 页面是否可操作不由后端 E2E 冒充；服务端合同已被精确 HTTP E2E 证明时，Browser 不通过 `page.evaluate(fetch(...))`、Browser-side direct HTTP 或人工构造请求重复模拟同一服务端 API bypass / 攻击矩阵。只有页面是否正确发起请求、Cookie / credentials / origin 等 Browser-native semantic、真实 UI wiring 或用户可操作流程等 Browser / UI 不可替代语义，才由对应 Browser evidence 承担。
5. 不因业务重要、“为了保险”、“最终代码态”或形式完整而机械运行完整套件；先选择受影响 spec，是否扩大验证范围遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.9。认证、公共 Guard/Pipe、Schema、共享测试基础设施、跨模块合同等横切变化通常构成扩大范围的依据，但该列表不是封闭枚举；其他经实际影响分析证明具有横切作用的变化同样可以构成依据。
6. 测试文件存在、测试名称或代码阅读不等于动态通过；报告必须区分“资产存在”和“本次已执行”。

跨层 Failure Attribution 与 Browser stop-loss 由 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 统一维护，Backend Playbook 不建立第二份分类。后端只记录项目级事实；例如 testing lifecycle / open-handle risk 是测试资产问题，不因其存在自动成为 production product defect。

## 4. 真实命令

命令生成期核验、discovery、定向执行、目标集合精确匹配、`not_executed` 判定与是否扩大测试范围统一遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.8 / §3.9；本节只保留 EduForge 当前真实 Jest / HTTP E2E runner 与命令入口。

以下命令均从 `backend` 目录执行：

```powershell
npm run lint
npm run typecheck
npm run build
npm run test -- --runInBand
```

`npm run lint` 与 `lint:fix` 覆盖 `src/**/*.ts`、`test/**/*.ts`、`scripts/**/*.ts`。

`npm run typecheck` 使用 `tsconfig.typecheck.json`，覆盖 `src/**/*.ts`、`test/**/*.ts`、`scripts/**/*.ts`；仅检查类型，不生成编译产物或增量缓存，不排除特定测试文件。该全量静态门禁不可由 build 或 Jest 运行结果替代。

普通 unit runner 的 Jest `rootDir` 为 `backend`；coverage 只统计 `src/**/*.(t|j)s`，输出到 `backend/coverage`。

`backend/test/*.e2e-spec.ts` 由 `test:e2e`（`test/jest-e2e.json`）独立管理，不进入普通 unit runner。HTTP E2E 必须在 Jest 启动前显式选择测试环境，并保持默认 cleanup：

`test:e2e` 通过 `node --experimental-vm-modules` 显式启动本地 Jest：当前 MongoDB Driver 的运行时适配器使用动态 `import('os')`，需要 Jest VM 的模块支持。参数由 package script 声明，下列命令无需依赖额外的 `NODE_OPTIONS` 注入。

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- --runInBand
```

定向 E2E 示例：

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- --runInBand --runTestsByPath ./test/users-me.e2e-spec.ts
```

`test:watch` 不用于正式验收。是否执行全量 unit/E2E 由实际影响决定，不把“最终验证”解释为无差别全量运行。

## 5. Database Purpose 与 Browser Process Roles

每个进程在一次运行中只能属于一个 database purpose：

| Purpose | 治理语义 |
|---|---|
| `none` | 当前进程不得连接业务数据库；适用于纯文档、不连接数据库的 pure/unit、lint、typecheck、build、Playwright / Browser runner 等进程 |
| `standard_test` | 普通 Jest、HTTP E2E 等标准测试用途，按测试资产合同使用和精确清理测试数据 |
| `browser_acceptance` | scripted / Agent-assisted Browser 在确需真实 backend/database 时使用的独立 Browser Acceptance 用途 |
| `development` | 本地真实开发与集成环境，不作为自动测试或生产运维用途 |
| `production_or_operations` | 生产或用户明确授权的生产运维动作，仅限该次授权范围 |

数据库具体名称、URI、账号与环境文件映射仍由 [Backend config matrix](./handoff-backend-config-matrix.md#1-数据库连接串与索引治理) 唯一维护，本手册不复制完整 Config Matrix。`standard_test` 与 `browser_acceptance` 使用独立 database 实现 database-level isolation；namespace、collection prefix 等逻辑隔离不能替代 database-level isolation。不同 purpose 不得在同一进程混用配置，也不得依赖继承变量、dotenv 顺序或后加载覆盖选择数据库。

Browser 相关进程角色边界：

| 进程 | Database purpose | 数据库角色 |
|---|---|---|
| Playwright / Browser runner | `none` | 不得直接获得或连接 Mongo APP / ADMIN URI |
| Browser backend | `browser_acceptance` | 通过独立 `start:browser-test` launcher 使用 Browser Acceptance APP connection；ADMIN 声明只校验、不注入 Nest 应用 |
| 文本教学任务 `process-ai` | `browser_acceptance` | 独立 APP 应用上下文；不 listen、不启动 Worker，只在独占验收时段消费唯一合格目标，见 §6.2 |
| 文本教学任务 `prepare/inspect/cleanup/replace` | `browser_acceptance` | 独立 ADMIN 管理进程；不导入 AppModule，不与 HTTP backend 或 Browser 合并，见 §6.2 |

Browser launcher foundation 负责受控启动、正常初始化所需索引元数据和公开 `GET /api` 健康请求，本身不创建业务数据或证明师生 UI。文本教学任务另有 §6.2 的专用支持，供真实前后端 Agent-assisted smoke 使用；这不构成扩张通用 fixture 框架的理由。

普通 HTTP E2E 使用独立 `NODE_ENV=test` 子进程，purpose 显式指定或默认解析为 `standard_test`；仅提供 `backend/.env.test`，启动前清除 shell 残留的主连接、管理连接和 Browser 变量，不与 Browser env 叠加。URI 声明门禁在连接前执行，Mongoose 实际 databaseName 在连接后验证；Browser launcher 在 AppModule 导入前和 listen 前分别执行门禁，错误立即拒绝。HTTP E2E 不得连接 Browser、development 或 production 数据库；Browser backend / 管理进程不得连接 standard_test、development 或 production 数据库。

最低充分证据入口（执行状态以当次报告为准）：

- `src/config/database-purpose.spec.ts`：purpose/URI/connected-name、APP/ADMIN 声明、环境隔离与 launcher 静态合同；先 `npm run test -- --listTests --runInBand --runTestsByPath ./src/config/database-purpose.spec.ts`，确认唯一目标后去掉 `--listTests` 执行。
- 代表性真实 HTTP 回归：`test/users-me.e2e-spec.ts`；先用相同定向参数加 `--listTests` 做 discovery，再运行本手册第 4 节命令。保持 spec-owned cleanup 与 app close。
- Browser 正向验收：独立前台运行 `npm run start:browser-test`（必要时通过 `BACKEND_PORT` 选择已核对空闲端口），确认实际数据库与安全启动摘要，再请求 `http://127.0.0.1:<port>/api` 得到 200。仅执行启动/健康检查时，停止该运行单元并确认端口释放即可；写入型文本教学 smoke 另须按 §6.2 精确 cleanup。

## 6. Fixture、Verifier 与 Cleanup

### 6.1 Current State

当前 HTTP E2E 原则上采用 spec-local 生命周期：

- spec 使用独立 app lifecycle、时间戳或唯一值创建任务专属合成数据，并通过 `request.agent` 保持 Session Cookie；当前已知 lifecycle 例外由第 7 节维护。
- 符合该 lifecycle 的 spec 在 `afterAll` 中按已记录 ID/唯一字段执行 scoped cleanup，并关闭自己创建的 Nest app；不使用 `dropDatabase`。
- 涉及 AI provider 的 E2E 使用 stub 或任务自有 mock HTTP server；默认不调用真实外部 AI，mock server 也必须由创建它的 spec 关闭。
- 启用受控 Worker 循环的专项须在自有 fixture cleanup 前停止定时调度并等待已发起的处理结束，再关闭 app / DB，避免处理与清理或断开连接竞争。
- 当前没有通用共享 Browser fixture 或集中式 cleanup 框架；文本教学任务使用 §6.2 的薄专用 CLI。HTTP E2E 的数据库终态仍由 spec 内断言与必要的 model 查询证明。
- spec-local repetition 本身不构成 gap；只有重复代码开始造成具体维护风险时，才按 [Codex instruction spec](../codex-instruction-spec.md) §3.10 评估最低充分 shared helper。
- `KEEP_E2E_DB=1` 只用于明确的本地诊断；正式验收和 CI 默认不得设置。保留数据时必须报告并由原 spec 的 ownership 信息指导精确清理。
- 写入超时或连接结果未知时不得直接重跑；先只读核对 app、数据库和任务 namespace 的实际状态。
- 第 5 节的 Browser Acceptance foundation 不自动要求 fixture、verifier 或 cleanup 资产；只有 Browser 持久写入或复杂跨进程终态无法由已有低层证据充分证明时，才允许评估新资产。

fixture、verifier、support 与 Browser infrastructure 的通用复杂度止损遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.10；本节只维护当前 EduForge 测试资产与 lifecycle 事实，不建立额外治理体系。

完全隔离于 production 和真实用户的 synthetic application test account（例如测试专用 teacher/student 用户名与密码），只有同时满足以下条件时，才可作为 tracked deterministic test constant：仅存在于测试数据库；不复用生产账号或真实个人密码；不提供基础设施权限；不能取得 Mongo、API、SMTP 或其他外部 Secret 能力。此类凭据是被测应用的普通测试常量，不是 infrastructure Secret。

Mongo password、production credential、Bailian API Key、SMTP password、第三方 service credential 与真实用户 credential 始终属于 Secret，不得 tracked、写入日志或报告。synthetic application credential 的有限规则不得用于放宽这些 Secret 边界。

### ZIP 资料证据与夹具

- `learning-tasks/ai-context` unit 负责真实 yauzl 精确读取与顺序、路径/realpath、格式/编码/CRC、声明/实际字节保护及关闭；用固定 stdlib ZIP 夹具与已知正文作独立 expected，两个维护中的第14章教材包仅只读核验，不以 reader 输出生成 expected。
- DTO / classroom-task-content / prompt / Processor unit 分别负责嵌套白名单及 null、快照深复制与公开投影、参考/作品分区和不可执行指令、资料错误在 stub/Provider 前终止。既有 budget/provider unit 继续证明实际 messages 计量、等于上限允许及请求预留前拒绝。
- 扩展既有 classroom text contract 与 Bailian context HTTP E2E，证明正式 API 白名单/持久化、最终生效引用验证与无部分写入、候选快照固定、成员投影、实际 mock HTTP 请求包含多包材料、异步资料失效/输入超限及首提作品保留。它们不证明 Browser、真实模型质量或课堂效果。
- 固定 ZIP 位于 `backend/test/fixtures/ai-context`；异常只作用于 spec-owned 临时目录副本，使用实例级窄范围读取根注入，不引入产品配置。HTTP 上下文继续 standard_test / APP、Worker=false、mail=log；每次消费前拒绝外来 PENDING/FAILED/RUNNING。finally 精确清理自有数据、Session、临时 ZIP、mock/Nest/DB，并验证残留；不修改真实教材或全库清空。

### 6.2 文本教学任务专用 Smoke 支持

入口为 `backend/scripts/browser-text-task-smoke.ts`，从 `backend` 目录运行以下命令；`b1-2-<unique>` 和 `<job-id>` 须替换为当前任务的准确值：

```powershell
npm run browser:text-smoke -- --help
npm run browser:text-smoke -- prepare --namespace b1-2-<unique> --frontend-port 3100 --backend-port 5100
npm run browser:text-smoke -- inspect --namespace b1-2-<unique> --prepared
npm run browser:text-smoke -- process-ai --namespace b1-2-<unique> --job-id <job-id> --confirm-exclusive b1-2-<unique>
npm run browser:text-smoke -- inspect --namespace b1-2-<unique>
npm run browser:text-smoke -- cleanup --namespace b1-2-<unique> --confirm-namespace b1-2-<unique>
```

- 每次调用为独立进程，仅读取 `backend/.env.browser-acceptance`，复用既有环境构造、用途/URI 声明门禁和连接后实际库名门禁；再核对实际 APP/ADMIN 数据库角色。完整数据库映射仍归 Config Matrix。
- `prepare` 只通过当前 UserSchema 和密码 helper seed namespace 专属 teacher/student；固定合成应用密码由脚本测试常量统一维护。课程、班级、四个不同已发布私有模板及入班走前端同源 BFF 的正式 HTTP API。课堂发布、作品提交、产品 AI 申请和教师反馈留给真实 Browser。
- `inspect --prepared` 只读核验账号固定值及最小前置；普通 `inspect` 读取 ownership 限定的资源、保存原文版本及 Job/反馈终态。异常前置不自动修复。确需替换时显式运行 `npm run browser:text-smoke -- replace --namespace b1-2-<unique> --confirm-namespace b1-2-<unique>`：先清理并核对旧残留，再重新准备；不得手工改密码或业务状态绕过核验。
- `process-ai` 在 APP/ADMIN 声明门禁通过后才动态导入 AppModule，以 `createApplicationContext` 启动且不 listen；实际 ConfigService 必须为 Browser 用途、stub、worker=false、debug=false，实际数据库名和 APP 角色也须匹配。正常索引初始化仍可能写入数据库。
- 处理前核对 Job→Submission→ClassroomTask→合成师生/班级的完整 ownership；全库 PENDING/FAILED/RUNNING 必须恰好只有目标，且为 budgetVersion=1、PENDING、attempts=0。外来、多目标或 legacy 非终态立即拒绝，不修改它们。随后只调用真实 `AiFeedbackProcessor.processOnce(1)` 一次，读取该目标及实际 stub 反馈核对结果，finally 等待上下文关闭。
- `processOnce` 是全库扫描入口，上述查询不是并发锁。操作者必须独占验收时段，排除其他 Worker/Profile/生产者并串行形成、消费目标；`--confirm-exclusive` 记录的是该运行前提，不能代替隔离审计。不启用长期 Worker、debug HTTP 或真实模型。
- 最小恢复记录仅保存 namespace、端口、准确资源 ID，位于 ignored `backend/coverage/browser-text-task-smoke/<namespace>.json`；Cookie 仅在准备过程内存中使用，不持久化 Cookie、Session、Mongo URI 或基础设施凭据。
- CLI 总截止为 120 秒，HTTP 请求 15 秒；ADMIN 连接建立/选择和查询采用有限超时，连接在 finally 中关闭。写入或 cleanup 结果不明时保留恢复记录，先用 `inspect` 和进程/端口审计确认实际状态，不直接重放。
- 清理前停止本轮写入与处理并等待在途动作结束。cleanup 使用准确 ID 和关联 ownership，顺序为 Feedback/Job → Submission → ClassroomTask/Task → Enrollment/Classroom/Course → 合成用户 Session/必要 PasswordResetToken → User；拒绝仍在 RUNNING 的自有 Job，不 dropDatabase、不清空集合。完成后核对业务与认证关联残留为零；同一 namespace 的 cleanup 可安全重复，恢复记录在确认资源收尾后再删除。
- 支持纯测试为 `scripts/browser-text-task-smoke.spec.ts`；沿第 4 节 Jest runner 用相同目标参数先 discovery，再执行。它只证明新增门禁、ownership、固定密码和 cleanup 选择，不证明真实 Browser 流程。

### 6.3 Future Admitted Lifecycle

以下合同用于未来按真实风险准入的其他 Browser Profile；当前文本教学专用资产见 §6.2，不表示已建立通用 fixture/verifier/cleanup 框架：

1. **Fixture 准入与边界：**先评估正式 API、已有 test factory / builder 或合法 synthetic seed 能否最低成本形成起点；只有它们不足时才新增专用 fixture。fixture 只构造 legal、minimal、deterministic、synthetic 前置，不得成为第二套产品、业务状态机、catalog / seed 治理或 UI 测试后门，也不得直接改库制造正式产品不可达状态、绕过业务不变量或引入 test-only lifecycle state；只能直接改库形成的状态须回到 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 的 `internal_corruption_only` 分类与 [Codex instruction spec](../codex-instruction-spec.md) §3.9 重新判断证据必要性。
2. **变更触发：**UI copy、layout、selector、styling 或 visual arrangement 变化本身不触发 fixture / verifier 数据合同变更；只有 DTO、Schema、ownership、role、lifecycle / state precondition、正式 API contract 或 Profile 所需持久业务事实真实变化时，才评估最低充分同步。
3. **Ownership、namespace 与进程角色：**每个 Profile 创建的持久 synthetic resource 必须具有唯一、可识别、可回收的 ownership / namespace，只能修改或清理自身资源；shared、canonical 与其他 Profile 数据默认只读，namespace 不替代 database-level isolation。进程角色继续遵循第 5 节：runner 为 `none` 且不持有 Mongo URI，Browser backend 使用 `browser_acceptance` APP connection，fixture / verifier / cleanup 管理进程使用 `browser_acceptance` ADMIN connection，APP 与 ADMIN 不得为方便而混入同一 runner / backend 进程。
4. **Verifier 职责：**只有正式不变量存在真实证据缺口时才建立 verifier。prepared verifier 原则上只读确认前置，不创建、修复、迁移、删除或补齐数据；不满足时报告 fixture / precondition 问题。post verifier 仅补 Browser 持久副作用中尚未由 HTTP E2E 或其他低层证据充分证明的部分，不为 Profile 完整感重复 role / ownership、state gate、rejection、idempotency、无非法副作用或数据库终态等既有证据；assertion 只锁定正式合同，不把历史偶然 count、调试字段、runner 信息、日志数量或非正式 cardinality 升级为门禁。
5. **最低充分闭环：**按实际准入步骤形成 `prepare → optional prepared verify → Browser backend / evidence → optional post verify → cleanup → optional residual verify`，并保持同一 Git code state、同一已验证前置与同一 ownership / namespace。该序列不是每个 Profile 的固定模板；不需要 fixture、数据库写入、verifier 或 residual 核对时必须省略对应步骤。
6. **Cleanup：**cleanup 必须 precise、ownership-scoped，并在可行时保持幂等与安全可重复；不得使用 `dropDatabase`、广域删除，也不得触碰未知、非当前 Profile 或其他执行中任务的资源。写入或 cleanup 结果不确定时，先只读核对服务端权威状态、ownership、已产生副作用与 residual，再决定下一步，不盲目重跑副作用或破坏性操作。
7. **Evidence Atomicity：**与 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 的完整证据闭环一致；不得把 Profile A 的 prepare、Profile B 的数据修改和 Profile A 的 verifier / cleanup 拼成一次通过。后续其他 Profile 失败，不自动推翻当前 Profile 已完整闭环且仍适用于当前代码态的证据。
8. **Stage / test-only coordination 防扩张：**不得为测试便利默认建立 Stage、test-only business state、direct-DB transition、hidden lifecycle 或 test-only synchronization state。只有正式产品可达的真实并发窗口确实存在且 HTTP E2E 等低层证据无法以更低复杂度充分证明时，才按 Spec §3.9 重新治理候选并设计最低充分协调；必须说明低层证据为何不足，并确认协调机制不复制产品状态机或形成第二套实现。
9. **复杂度 stop-loss：**继续遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.10。fixture / verifier / support 一旦开始复制业务状态机、服务端判断、catalog、大量真实产品数据、独立于产品的 lifecycle，或为每个 Profile 扩张大量 support code，必须停止扩张，并重新评估是否下沉 HTTP E2E、改用 Agent-assisted / Human、缩小 Profile，或取消不需要的 Browser evidence。

## 7. Current Known Gaps

当前无已确认的 Backend Testing Known Gap。

## 8. Maintenance / Non-goals

- 新增或修改测试时同步本手册的资产类型、命令、数据库用途或 lifecycle 事实；API/配置事实回到各自 Owner。
- 不按测试文件逐条扩张 inventory，不追求某层数量非零，不把开发日志或历史通过次数长期堆入本文。
- 当前 Playwright runner、FT-02 scripted non-UI micro-profile、Browser backend launcher 与 `browser_acceptance` database foundation 按真实风险复用；不因追求测试层数量、覆盖率或假设性风险继续扩张 Browser 资产，fixture / verifier 等新资产仍须通过最低充分准入后按需建设。
