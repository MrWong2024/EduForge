# EduForge 后端测试治理手册

## 1. Scope / Owner

本文是 EduForge 后端测试证据、测试数据库用途、E2E fixture 生命周期与 cleanup 规则的唯一 Owner。通用 E2E 原则见 [E2E Testing](../e2e-testing.md)；数据库名、连接变量和运行模式的完整映射由 [Backend config matrix](./handoff-backend-config-matrix.md) 维护；前端测试、Browser evidence 与 smoke 由 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 维护。

本文不复制 API、DTO、Service 或配置明细，也不保存逐轮执行日志、覆盖率流水或完整 spec inventory。

## 2. Current Test Baseline

基于当前仓库资产，后端证据分层如下：

| 层级 | 当前资产与工具 | 主要证明语义 |
|---|---|---|
| Pure / Static | `npm run lint`、`npm run build` | lint、TypeScript/Nest 编译、import 与静态结构 |
| Unit / Service / Controller | `backend/src/**/*.spec.ts`，Jest + ts-jest | Service 分支、Controller 参数传递、局部规则、mapper 与错误边界 |
| HTTP E2E / Integration | `backend/test/*.e2e-spec.ts`，当前 28 个 Jest + Supertest spec | 真实 Nest HTTP、Guard/Pipe/DTO、Session、角色/ownership、MongoDB 终态与跨模块链路 |
| Scripted Browser | 后端无此类 runner；项目当前资产见 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) | 不可由低层证明的 Browser-native 合同由前端 Owner 治理 |
| Agent-assisted / Human smoke | 不属于后端自动测试 Owner | 真实产品 UI 可操作性与主观教学/UX 判断，见 Frontend testing playbook |

Unit 与 HTTP E2E 可以覆盖同一业务区域，但不得重复承担同一主断言：局部规则留在 unit，真实 HTTP/认证/数据库终态留在 E2E。

## 3. 最低充分证据选择

1. 纯函数、Service 分支、Controller 参数传递和廉价防御优先用 unit。
2. 需要证明真实路由、Guard、Pipe、DTO whitelist、Cookie Session、角色/ownership、公开错误合同或 MongoDB 终态时使用 HTTP E2E。
3. 页面是否可操作不由后端 E2E 冒充；服务端合同已被精确 E2E 证明时，不在 Browser 重复非法调用矩阵。
4. 不因业务重要就机械运行完整套件。先选择受影响 spec；只有认证、公共 Guard/Pipe、Schema、共享测试基础设施或跨模块合同发生变化时才扩大范围。
5. 测试文件存在、测试名称或代码阅读不等于动态通过；报告必须区分“资产存在”和“本次已执行”。

## 4. 真实命令

以下命令均从 `backend` 目录执行：

```powershell
npm run lint
npm run build
npm run test -- --runInBand
```

HTTP E2E 必须在 Jest 启动前显式选择测试环境，并保持默认 cleanup：

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

## 5. Database Purpose

- `standard_test → eduforge_test` 与 `browser_acceptance → eduforge_browser_test` 已物理隔离；完整配置合同见 [Backend config matrix](./handoff-backend-config-matrix.md#1-数据库连接串与索引治理)。
- 普通 HTTP E2E 使用独立 `NODE_ENV=test` 子进程，purpose 显式指定或默认解析为 `standard_test`；仅提供 `backend/.env.test`，启动前清除 shell 残留的主连接、管理连接和 Browser 变量，不与 Browser env 叠加。
- Browser backend 使用独立 `start:browser-test` launcher，仅读取 ignored `.env.browser-acceptance`。应用连接与普通 E2E 数据库隔离，admin URI 仅校验声明，不建立 admin 连接。
- URI 声明门禁在连接前执行，Mongoose 实际 databaseName 在连接后验证；Browser launcher 在 AppModule 导入前和 listen 前分别执行门禁，错误立即拒绝。
- pure/unit/lint/build 的用途为 `none`，不连接数据库。HTTP E2E 不得连接 Browser、development 或 production 数据库；Browser backend 不得连接 standard_test、development 或 production 数据库。
- 当前 foundation 支持受控启动、正常初始化所需索引元数据和公开 `GET /api` 健康请求；不创建业务数据、Browser fixture、verifier 或 UI/DB Profile，不代表真实 Teacher/Student Browser 登录已验收。

最低充分证据入口（执行状态以当次报告为准）：

- `src/config/database-purpose.spec.ts`：purpose/URI/connected-name、APP/ADMIN 声明、环境隔离与 launcher 静态合同；先 `npm run test -- --listTests --runInBand --runTestsByPath ./src/config/database-purpose.spec.ts`，确认唯一目标后去掉 `--listTests` 执行。
- 代表性真实 HTTP 回归：`test/users-me.e2e-spec.ts`；先用相同定向参数加 `--listTests` 做 discovery，再运行本手册第 4 节命令。保持 spec-owned cleanup 与 app close。
- Browser 正向验收：独立前台运行 `npm run start:browser-test`（必要时通过 `BACKEND_PORT` 选择已核对空闲端口），确认实际数据库与安全启动摘要，再请求 `http://127.0.0.1:<port>/api` 得到 200。仅停止该运行单元并确认端口释放，不执行数据库 cleanup。

## 6. Fixture、Verifier 与 Cleanup

当前 E2E 采用 spec-local 生命周期：

- 27/28 个 E2E spec 使用独立 app lifecycle、时间戳或唯一值创建任务专属合成数据，并通过 `request.agent` 保持 Session Cookie。
- 这些 spec 在 `afterAll` 中按已记录 ID/唯一字段执行 scoped cleanup，并关闭 Nest app；不使用 `dropDatabase`。
- 涉及 AI provider 的 E2E 使用 stub 或任务自有 mock HTTP server；默认不调用真实外部 AI，mock server 也必须由创建它的 spec 关闭。
- 当前没有共享 fixture CLI、独立 database verifier 或集中式 cleanup runner。数据库终态主要由 spec 内断言与必要的 model 查询证明。
- `KEEP_E2E_DB=1` 只用于明确的本地诊断；正式验收和 CI 默认不得设置。保留数据时必须报告并由原 spec 的 ownership 信息指导精确清理。
- 写入超时或连接结果未知时不得直接重跑；先只读核对 app、数据库和任务 namespace 的实际状态。

## 7. Current Known Gaps

- `backend/test/app.e2e-spec.ts` 在 `beforeEach` 创建 app，但当前没有对应 `afterEach/afterAll` 关闭 app；这是测试 lifecycle/open-handle 风险，不是产品缺陷。本任务不修改测试资产。
- E2E bootstrap、合成账号/数据准备与 cleanup 仍以 spec-local 方式重复；只有重复开始造成真实维护风险时，才考虑最低充分的共享 helper。
- 当前没有独立 verifier/fixture registry。只有未来 Browser 写入或复杂跨进程终态无法由 HTTP E2E 充分证明时，才评估新增。
- 后端 Session E2E 使用 Supertest agent 证明 HTTP Cookie 链路，但不证明真实 BrowserContext、reload、CORS/credentials 或 BFF 的 Browser-native 语义；是否需要该证据由 Frontend testing playbook 的准入规则判断。

## 8. Maintenance / Non-goals

- 新增或修改测试时同步本手册的资产类型、命令、数据库用途或 lifecycle 事实；API/配置事实回到各自 Owner。
- 不按测试文件逐条扩张 inventory，不追求某层数量非零，不把开发日志或历史通过次数长期堆入本文。
- 不因当前缺少 Browser 资产而安装 runner、创建专用数据库或扩大 fixture 基础设施。
