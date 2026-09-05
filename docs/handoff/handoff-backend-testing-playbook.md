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
| Unit / Service / Controller | `backend/src/**/*.spec.ts` + `backend/scripts/**/*.spec.ts`，Jest + ts-jest；当前 scripts spec 为 0 | Service 分支、Controller 参数传递、局部规则、mapper 与错误边界 |
| HTTP E2E / Integration | `backend/test/*.e2e-spec.ts`，当前 28 个 Jest + Supertest spec | 真实 Nest HTTP、Guard/Pipe/DTO、Session、角色/ownership、MongoDB 终态与跨模块链路 |
| Scripted Browser | runner 由 frontend 维护；当前有 1 个 BFF Cookie / BrowserContext micro-profile；后端已具备 Browser backend launcher 与 `browser_acceptance` database foundation | 不可由低层证明的 Browser-native 合同由前端 Owner 治理 |
| Agent-assisted / Human smoke | 不属于后端自动测试 Owner | 真实产品 UI 可操作性与主观教学/UX 判断，见 Frontend testing playbook |

Unit 与 HTTP E2E 可以覆盖同一业务区域，但不得重复承担同一主断言：局部规则留在 unit，真实 HTTP/认证/数据库终态留在 E2E。

## 3. 最低充分证据选择

1. 纯函数、Service 分支、Controller 参数传递和廉价防御优先用 unit。
2. HTTP E2E 的项目级证明能力包括真实 Nest HTTP route、authentication / Session、authorization / role、Guard / Pipe、DTO whitelist、ownership、lifecycle / state gate、rejection semantics、非法调用无业务副作用，以及必要的 MongoDB 权威终态。
3. Risk Classification 定义采用 [Frontend testing playbook](./handoff-frontend-testing-playbook.md)，验证候选生成、风险必要性判断及风险到最低充分证据层的分配遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.9；本节只维护后端证据能力与跨层不重复证明边界，不另建 risk → evidence mapping。
4. 页面是否可操作不由后端 E2E 冒充；服务端合同已被精确 HTTP E2E 证明时，Browser 不通过 `page.evaluate(fetch(...))`、Browser-side direct HTTP 或人工构造请求重复模拟同一服务端 API bypass / 攻击矩阵。只有页面是否正确发起请求、Cookie / credentials / origin 等 Browser-native semantic、真实 UI wiring 或用户可操作流程等 Browser / UI 不可替代语义，才由对应 Browser evidence 承担。
5. 不因业务重要就机械运行完整套件。先选择受影响 spec；只有认证、公共 Guard/Pipe、Schema、共享测试基础设施或跨模块合同发生变化时才扩大范围。
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

数据库具体名称、URI、账号与环境文件映射仍由 [Backend config matrix](./handoff-backend-config-matrix.md#1-数据库连接串与索引治理) 唯一维护，本手册不复制完整 Config Matrix。`standard_test` 与 `browser_acceptance` 已物理数据库隔离；namespace、collection prefix 等逻辑隔离不能替代 database-level isolation。不同 purpose 不得在同一进程混用配置，也不得依赖继承变量、dotenv 顺序或后加载覆盖选择数据库。

Browser 相关进程角色边界：

| 进程 | Database purpose | 数据库角色 |
|---|---|---|
| Playwright / Browser runner | `none` | 不得直接获得或连接 Mongo APP / ADMIN URI |
| Browser backend | `browser_acceptance` | 通过独立 `start:browser-test` launcher 使用 Browser Acceptance APP connection；ADMIN 声明只校验、不注入 Nest 应用 |
| 未来按真实 profile 风险准入的 fixture / verifier / cleanup | `browser_acceptance` | 作为独立管理进程使用 Browser Acceptance ADMIN connection；不得与 Browser backend 或 runner 合并 |

写下上述角色边界不构成现在新增 fixture、verifier 或 cleanup 的理由。当前 foundation 只支持受控启动、正常初始化所需索引元数据和公开 `GET /api` 健康请求；不创建业务数据或 UI/DB Profile，也不代表真实 Teacher/Student Browser 登录已验收。

普通 HTTP E2E 使用独立 `NODE_ENV=test` 子进程，purpose 显式指定或默认解析为 `standard_test`；仅提供 `backend/.env.test`，启动前清除 shell 残留的主连接、管理连接和 Browser 变量，不与 Browser env 叠加。URI 声明门禁在连接前执行，Mongoose 实际 databaseName 在连接后验证；Browser launcher 在 AppModule 导入前和 listen 前分别执行门禁，错误立即拒绝。HTTP E2E 不得连接 Browser、development 或 production 数据库；Browser backend / 管理进程不得连接 standard_test、development 或 production 数据库。

最低充分证据入口（执行状态以当次报告为准）：

- `src/config/database-purpose.spec.ts`：purpose/URI/connected-name、APP/ADMIN 声明、环境隔离与 launcher 静态合同；先 `npm run test -- --listTests --runInBand --runTestsByPath ./src/config/database-purpose.spec.ts`，确认唯一目标后去掉 `--listTests` 执行。
- 代表性真实 HTTP 回归：`test/users-me.e2e-spec.ts`；先用相同定向参数加 `--listTests` 做 discovery，再运行本手册第 4 节命令。保持 spec-owned cleanup 与 app close。
- Browser 正向验收：独立前台运行 `npm run start:browser-test`（必要时通过 `BACKEND_PORT` 选择已核对空闲端口），确认实际数据库与安全启动摘要，再请求 `http://127.0.0.1:<port>/api` 得到 200。仅停止该运行单元并确认端口释放，不执行数据库 cleanup。

## 6. Fixture、Verifier 与 Cleanup

### 6.1 Current State

当前 E2E 采用 spec-local 生命周期：

- 27/28 个 E2E spec 使用独立 app lifecycle、时间戳或唯一值创建任务专属合成数据，并通过 `request.agent` 保持 Session Cookie。
- 这些 spec 在 `afterAll` 中按已记录 ID/唯一字段执行 scoped cleanup，并关闭 Nest app；不使用 `dropDatabase`。
- 涉及 AI provider 的 E2E 使用 stub 或任务自有 mock HTTP server；默认不调用真实外部 AI，mock server 也必须由创建它的 spec 关闭。
- 当前共享 Browser fixture CLI = 0、独立 database verifier = 0、集中式 Browser cleanup runner = 0。数据库终态主要由 spec 内断言与必要的 model 查询证明。
- `KEEP_E2E_DB=1` 只用于明确的本地诊断；正式验收和 CI 默认不得设置。保留数据时必须报告并由原 spec 的 ownership 信息指导精确清理。
- 写入超时或连接结果未知时不得直接重跑；先只读核对 app、数据库和任务 namespace 的实际状态。
- 第 5 节的 Browser Acceptance foundation 不自动要求 fixture、verifier 或 cleanup 资产；只有 Browser 持久写入或复杂跨进程终态无法由已有低层证据充分证明时，才允许评估新资产。

fixture、verifier、support 与 Browser infrastructure 的通用复杂度止损遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.10；本节只维护当前 EduForge 测试资产与 lifecycle 事实，不建立额外治理体系。

完全隔离于 production 和真实用户的 synthetic application test account（例如测试专用 teacher/student 用户名与密码），只有同时满足以下条件时，才可作为 tracked deterministic test constant：仅存在于测试数据库；不复用生产账号或真实个人密码；不提供基础设施权限；不能取得 Mongo、API、SMTP 或其他外部 Secret 能力。此类凭据是被测应用的普通测试常量，不是 infrastructure Secret。

Mongo password、production credential、Bailian API Key、SMTP password、第三方 service credential 与真实用户 credential 始终属于 Secret，不得 tracked、写入日志或报告。synthetic application credential 的有限规则不得用于放宽这些 Secret 边界。

### 6.2 Future Admitted Lifecycle

以下合同仅在未来真实 Browser Profile 已通过准入且确实需要对应资产后生效，不表示 EduForge 当前已经拥有 fixture、verifier 或 Browser cleanup runner：

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

- `backend/test/app.e2e-spec.ts` 在 `beforeEach` 创建 app，但当前没有对应 `afterEach/afterAll` 关闭 app；这是测试 lifecycle/open-handle 风险，不是产品缺陷。本任务不修改测试资产。
- E2E bootstrap、合成账号/数据准备与 cleanup 仍以 spec-local 方式重复；只有重复开始造成真实维护风险时，才考虑最低充分的共享 helper。
- 当前没有独立 verifier/fixture registry。只有未来 Browser 写入或复杂跨进程终态无法由 HTTP E2E 充分证明时，才评估新增。
- 后端 Session E2E 使用 Supertest agent 证明 HTTP Cookie 链路，但不证明真实 BrowserContext、reload、CORS/credentials 或 BFF 的 Browser-native 语义；是否需要该证据由 Frontend testing playbook 的准入规则判断。

## 8. Maintenance / Non-goals

- 新增或修改测试时同步本手册的资产类型、命令、数据库用途或 lifecycle 事实；API/配置事实回到各自 Owner。
- 不按测试文件逐条扩张 inventory，不追求某层数量非零，不把开发日志或历史通过次数长期堆入本文。
- 当前 Playwright runner、FT-02 scripted non-UI micro-profile、Browser backend launcher 与 `browser_acceptance` database foundation 按真实风险复用；不因追求测试层数量、覆盖率或假设性风险继续扩张 Browser 资产，fixture / verifier 等新资产仍须通过最低充分准入后按需建设。
