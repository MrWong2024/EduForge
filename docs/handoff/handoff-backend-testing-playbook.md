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

`src/modules/auth/services/auth-index-initialization.spec.ts` 的数据库用途为 `none`，通过实际 Nest `TestingModule.init()` 验证 `SessionService` 和 `PasswordResetService` 初始化期间不会主动调用索引写入入口。

`test/submission-edit.e2e-spec.ts` 负责同次作品修改与正式评阅受理的真实 HTTP、版本竞争、首次提交事实、历史兼容及部分失败续行；复用正式鉴权/发布/提交与 spec-owned cleanup，不添加生产测试开关。expectedRevision 变更涉及的既有反馈/AI 请求继续保留各自原业务断言。该套件还控制同一条教师反馈的两个 PATCH 重叠及写入顺序，比较两次 HTTP 回执、独立 Mongo 回读和反馈列表。合同明细引用 [Service Card 08](./handoff-backend-service-map.md#service-card-08)，实际 discovery/执行及退出码归当次报告。

`src/modules/learning-tasks/task-difficulty-validation.spec.ts` 不连接数据库，通过实际 CreateTaskDto / UpdateTaskDto 和内存 Mongoose Task 模型验证四状态、仅 undefined 跳过及 null/异常输入拒绝，不以常量数组断言替代真实校验。

`test/classroom-text-task-contract.e2e-spec.ts` 在既有文本教学验收内负责难度四状态写入、省略/清空、非法 POST/PATCH 无新增或字段/时间戳变化、新发布拒绝非法来源，以及历史快照/只读 fallback 可读且不回写；同时保留模板列表与候选的严格查询、分页前组合过滤、items/total 一致和权限证据。expected 来自显式 fixture ID 和锁定合同，复用 spec-owned namespace 与 cleanup；不证明 Browser 操作或导航竞争，字段合同见 [DTO](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family)，发布边界见 [Service](./handoff-backend-service-map.md#service-card-07)。

AI 反馈介入分析的 `ai-learning-analytics.service.spec.ts` 以独立固定时间线与手算结果覆盖 V1.2 配对、来源/时间缺证、空值和聚合；`test/classroom-ai-learning-analytics.e2e-spec.ts` 负责正式提交→修改→手动申请后的字段读取、三 API 一致性、授权/隔离/筛选、GET 前后持久事实不变及精确清理。统计 E2E 可构造 spec-owned Job/Feedback 完成事实，它证明读取计算，不证明 Provider 执行或真实模型质量；不以当前实现输出生成 expected。现行算法与字段分别归 [Service](./handoff-backend-service-map.md#service-card-08i) / [DTO](./handoff-backend-dto-cheatsheet.md#ai-learning-analytics)，实际执行状态归当次报告。

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

普通 unit runner 的 Jest `rootDir` 为 `backend`；coverage 只统计 `src/**/*.(t|j)s`，输出到仓库根目录下的 `.local/deliverables/coverage/`，报告可再生成。

`backend/test/*.e2e-spec.ts` 由 `test:e2e`（`test/jest-e2e.json`）独立管理，不进入普通 unit runner。HTTP E2E 必须在 Jest 启动前显式选择测试环境，并保持默认 cleanup：

`test:e2e` 通过 `node --experimental-vm-modules` 显式启动本地 Jest：当前 MongoDB Driver 的运行时适配器使用动态 `import('os')`，需要 Jest VM 的模块支持。参数由 package script 声明，下列命令无需依赖额外的 `NODE_OPTIONS` 注入。

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
npm run test:e2e -- --runInBand
```

定向 E2E 示例：

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
npm run test:e2e -- --runInBand --runTestsByPath ./test/users-me.e2e-spec.ts
```

`test:watch` 不用于正式验收。是否执行全量 unit/E2E 由实际影响决定，不把“最终验证”解释为无差别全量运行。

### 认证与凭据生命周期定向验收

离线 unit 的用途为 `none`：`src/modules/users/password.utils.spec.ts` 负责 Unicode 码点、trim/原文、UTF-8 字节边界及超限输入不进入 bcrypt；`src/common/filters/all-exceptions.filter.spec.ts` 负责公开 code 白名单和 5xx 脱敏。配置与 AuthController 单测证明 Cookie Secure 的 boolean 来源及消费；PasswordResetService 单测证明占位失败、时钟倒退及邮件失败只影响本次 token；现有 auth-index-initialization 单测继续证明 Service 初始化零主动 DDL。导入与索引离线证据仍按下节分工，不以 fake 结果代替 Mongo 终态。

`test/auth-security.e2e-spec.ts` 与既有 `users-me/users-change-password` HTTP E2E 使用正式 configureApp、Cookie parser、ValidationPipe、SessionAuthGuard 和异常过滤器。认证安全 spec 以真实 HTTP/Mongo 及受控 Promise 屏障证明 tokenHash 存储、Cookie 输入边界、active/版本认证、改密当前会话保留、重置/找回竞争和正式导入 Store 的凭据轮换；不以 sleep 排程，不发送真实邮件或调用真实模型，也不证明第二批前端交互。

窄准备逻辑 `test/helpers/auth-test-environment.ts` 在 AppModule 导入前建立独立 `test/standard_test` 进程环境，仅解析 `.env.test` 的目标连接，清除继承连接与外部服务配置，在测试层阻止 AppModule 叠加加载其它环境文件。`auth-session-indexes.ts` 先核对实际库名 `eduforge_test`、本机单节点 `rs0` 的可写 PRIMARY 和 `root@admin` 身份及角色，并确认认证集合无外来数据，再以正式 SessionSchema 及现有 sync-indexes CLI 预览、限定 apply 和读回。只允许删除已核实定义的旧 `token_1`，建立当前 Session 必需索引，发现其它删改计划即停止。

同一认证集合的实库 spec 串行运行，与 sync-indexes 的独立集合集成分开进程。合成记录按 spec 登记 ID 清理，核对 User/Session/reset token 零残留后关闭 app 与独立 Store 连接；不清空未知记录或数据库。配置或门禁不符时停止对应实库验收，实际通过、失败和未执行状态归当次任务报告。

真实门禁、索引盘点和定向清理使用各操作现有的有限期限。原来共享截止时间的流程继续传递剩余量。清理回执不明时停止后续删除，保留准确目标供只读核对。

使用 `openAuthTestConnection()` 的定向 E2E 按操作路径应用期限。直接夹具设置各自的操作预算。启用 `budgetModelReads` 后，受支持的模型读取在进入 MongoDB 调用前设置 10 秒信号，选服与连接池排队计入该预算，已有较短的服务端上限继续生效。多批读取中，已经发出的 `getMore` 可能在截止时间之后才收尾。正式模型写入适用所用连接的阶段上限和该操作指定的服务端上限。

- **直接夹具。** 合成用户经实际 Mongoose Schema 校验和序列化后，用带信号的原生写命令持久化。归属查询、定向清理及残留读回继续使用已有的较短操作期限。CSV 安全套件的单次操作有 10 秒预算，原有 5 秒服务端限制仍生效。写入已派发且回执不明时，等待驱动调用收尾，按本次命令标记只读检查在途操作，再按自有 ID 核对。相关写入和清理保持停止，保留 ID 供后续核对。
- **注入的 HTTP 模型。** CSV 安全、课堂报表、提交冷却和教学资源四个套件在测试连接的 Mongoose 查询执行入口为 `find`、`findOne`、`countDocuments` 及只读聚合设置 10 秒信号，保留较短服务端限制。登录的会话创建与删除、用户资料更新、课程和班级创建或变更、入班写入、任务模板和课堂任务的创建及状态更新使用正式模型。普通模型的创建、保存、更新、删除与 `distinct` 仍分别受 5 秒选服、10 秒排队、10 秒 socket 等待及原有服务端限制约束。课堂事务专池遵循既有事务期限。
- **真实导入 Store。** 认证套件通过 `openAuthTestConnection({ budgetModelReads: true })` 建立独立连接，正式 Store 的用户查找受 10 秒测试读取信号约束。用户 CAS 更新、旧会话删除和旧重置令牌作废由 `createMongooseStore()` 的正式 Mongoose 方法执行，使用该测试连接的 5 秒选服、10 秒连接池排队和 10 秒 socket 等待上限。四个操作均设置 `maxTimeMS: 5000`，约束服务端执行时间。正式导入 CLI 以其独立连接配置为准。

从 `backend` 目录先 discovery；结果须恰好命中同一显式集合，再正式运行。以下离线命令使用独立 `none` 进程，不加载真实环境文件、不继承真实 Mongo/SMTP/Provider 凭据：

```powershell
$env:NODE_ENV = "test"
npm.cmd run test -- --listTests --runInBand --runTestsByPath ./src/modules/users/password.utils.spec.ts ./src/common/filters/all-exceptions.filter.spec.ts
npm.cmd run test -- --runInBand --runTestsByPath ./src/modules/users/password.utils.spec.ts ./src/common/filters/all-exceptions.filter.spec.ts
```

HTTP 集合在另一独立 `standard_test` 进程中运行，沿本节窄 helper 的环境与认证门禁：

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/auth-security.e2e-spec.ts ./test/users-me.e2e-spec.ts ./test/users-change-password.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/auth-security.e2e-spec.ts ./test/users-me.e2e-spec.ts ./test/users-change-password.e2e-spec.ts
```

### 过程性评价 CSV 安全定向验收

`src/modules/classrooms/services/process-assessment.service.spec.ts` 的导出区段使用 `none` 用途，负责 [DTO Process Assessment](./handoff-backend-dto-cheatsheet.md#process-assessment) 的文本中和、准确 TAB/引用/转义、普通文本与数值、BOM/列顺序/空结果及输入 payload 不变；既有聚合、排除项和评分回归继续由同一 Service spec 承担。独立字面 expected 来自锁定合同，含引用换行的行列及内容检查复用 `scripts/import-users-csv.ts` 的 `parseCsv`，不以分隔符 split 冒充 CSV 解析。

`test/process-assessment-csv-security.e2e-spec.ts` 负责正式资料更新到 owner 教师 JSON/CSV 导出的窄 HTTP/Mongo 链路，以及同一导出入口的未认证、学生和非 owner 教师拒绝。它在 AppModule 导入前复用 `test/helpers/auth-test-environment.ts`，并使用 `prepareAuthSessionIndexes`、正式 `configureApp` 和 `assertAuthTestConnection`；环境、身份与限定索引准备沿用[认证与凭据生命周期定向验收](#认证与凭据生命周期定向验收)，不扩大 helper 或全模型索引同步。只准备 namespace 专属合成账号及最小课程、班级、成员，不创建任务/提交/反馈/AI Job；核对资料原值、既有 JSON trim 投影和 CSV 安全编码，按登记 ID 与关联归属精确清理并在 finally 关闭应用/连接、恢复测试环境。

该 HTTP spec 不重复完整编码矩阵或课堂评分 E2E，不证明 Browser、Excel/WPS 实际运行或真实存量对齐。先 discovery 恰好命中所选单个 spec，再在对应独立 `none` / `standard_test` 进程使用相同路径运行；实际执行结果归当次任务报告。

### 教学资源写入定向验收

`test/teaching-resource-write-contract.e2e-spec.ts` 通过正式 HTTP、ValidationPipe 和 Mongo 回读，负责课程/班级/模板必填文本与课程/班级 PATCH status 的拒绝及无写入副作用、合法局部更新、模板分类省略保留与显式清空，以及合法文本保真。字段合同由 [DTO Courses](./handoff-backend-dto-cheatsheet.md#course-dto--response-family)、[Classrooms](./handoff-backend-dto-cheatsheet.md#classroom-与正式成员-family) 与 [Task template](./handoff-backend-dto-cheatsheet.md#task-template-dto--response-family) 维护；环境、认证与连接门禁复用[认证与凭据生命周期定向验收](#认证与凭据生命周期定向验收)，不运行 Browser。

该 spec 同时覆盖模板编辑、发布和归档的请求交错，以及首次发布时间和局部字段的真实写入结果。`src/modules/learning-tasks/services/learning-tasks.service.spec.ts` 负责写入条件、入口权限差异、无写入编辑和原子更新落空后的分流。引用竞争由 [ZIP 定向验收](#zip-资料证据与夹具) 承担。写入条件见 [Service Card 08](./handoff-backend-service-map.md#service-card-08)。

从 `backend` 目录在独立 `standard_test` 进程使用现有 `test:e2e` 入口，先确认 discovery 仅命中该文件，再以相同路径定向执行：

```powershell
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/teaching-resource-write-contract.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/teaching-resource-write-contract.e2e-spec.ts
```

### 课堂报表任务状态定向验收

`test/classroom-report-task-status.e2e-spec.ts` 通过正式发布、关闭、撤回及提交入口，负责过程性评价的撤回排除、关闭任务参与及手工排除关系，并核对 JSON、CSV 与快照 processAssessment 的明示业务预期，以及教师看板空任务时 summary 自身的完整数值字段。有效任务与计分合同见 [Service Card 08G](./handoff-backend-service-map.md#service-card-08g)，公开字段见 [DTO Dashboard](./handoff-backend-dto-cheatsheet.md#teacher--student-dashboard-response-family)；评分边界、CSV 安全编码及非空看板统计继续由既有 Service unit 承担。环境、认证与连接门禁复用[认证与凭据生命周期定向验收](#认证与凭据生命周期定向验收)。

该 spec 同时承担教师对同一课堂任务实例的配置/状态并发条件写入证据，通过正式 HTTP 与 Mongo 终态核对成功、按当前资源/状态安全拒绝以及不覆盖已生效修改；正常顺序更新与 ACTIVE/CLOSED 配置编辑仍按既有门禁验证。公开竞争结果与无自动重试边界见 [API Classroom Tasks](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源)。

从 `backend` 目录在独立 `standard_test` 进程使用现有 `test:e2e` 入口，先确认 discovery 仅命中该文件，再以相同路径定向执行：

```powershell
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/classroom-report-task-status.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/classroom-report-task-status.e2e-spec.ts
```

### AI 反馈与 Job 原子完成定向验收

从 `backend` 先用 `npm.cmd run test -- --listTests --runInBand --runTestsByPath ./src/modules/learning-tasks/ai-feedback/services/ai-feedback-processor.service.spec.ts ./src/lib/classroom-task-transaction.spec.ts` 核对目标，再去掉 `--listTests` 执行无库单测，覆盖认领失效、本地事务重试和提交未确认。

以下实库套件逐文件在独立 `standard_test` 进程串行执行。先用 `npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath <文件>` 核对发现范围，再去掉 `--listTests` 执行。按第 5、6 节核对默认、命名事务和独立回读连接及精确清理，消费前拒绝外来 Job。

- `./test/learning-tasks.ai-feedback.bailian-context.e2e-spec.ts` 通过正式学生入口创建并申请评阅。定时 Worker 关闭，模型由本机 HTTP 替身返回，Mongo 写入、提交或回滚以及学生反馈 GET 均真实执行。事务测试在实际插入后暂停，用事务外读核对可见性及预留、usage 保留。处理口径见 [Service Card 13](./handoff-backend-service-map.md#service-card-13)。
- `./test/learning-tasks.ai-feedback.ops.e2e-spec.ts` 回归正式手工 process-once 和定时 stub Worker。
- `./test/classroom-review-pack.e2e-spec.ts` 保留读侧真实聚合屏障，用原子完成夹具核对评阅完成交错中的分组。

### 课程删除与建班定向验收

`test/course-lifecycle.e2e-spec.ts` 使用正式 `configureApp`、HTTP 路由和 Mongo 回读。它保留课程生命周期和权限回归，并负责删除空课程与建班竞争的两种提交顺序。测试在一方完成真实 Course 写入后暂停该事务，观察另一方争用同一文档，再放行先写入方提交。分别核对两个响应、课程和关联班级的终态以及建班后的课程时间戳。公开结果见 [API Courses](./handoff-backend-api-map.md#courses)，协调写与重试规则见 [Service Card 03](./handoff-backend-service-map.md#service-card-03) 和 [Service Card 04](./handoff-backend-service-map.md#service-card-04)。

该套件通过默认连接的目标写入屏障，覆盖编辑与归档的两种顺序、删除先于编辑、成功编辑后删除，并核对归档回执名称、正式 GET 和独立 Mongo 终态。
同一屏障还覆盖显式原名或显式清空分类随归档写入，以及并发重复归档保留首次写入的时间戳。

首次夹具写入前核对默认连接及课堂事务连接的实际库名和本机副本集，并验证事务可用。套件关闭自动建索引，使用现有唯一索引验证实际 joinCode 碰撞、换码成功及首次协调写回滚。清理前释放暂停点并等待已发出的请求，在本批课程归属内回读并清理班级，覆盖未取得响应 ID 的写入。`src/modules/classrooms/services/classrooms.service.spec.ts` 在离线模式检查换码次数上限和禁止重放的错误边界。

从 `backend` 目录在独立 `standard_test` 进程执行以下命令。Discovery 必须只命中该文件。

```powershell
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/course-lifecycle.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/course-lifecycle.e2e-spec.ts
```

### 班级删除与入班、发布定向验收

`test/classroom-lifecycle.e2e-spec.ts` 经正式 HTTP 路由验证删班与入班、删班与发布各自的两种提交顺序。测试在一方实际写入 Classroom 后暂停，观察另一事务在同一文档上的 Mongo 写冲突，再放行指定一方提交。双响应与独立 Mongo 回读核对班级、成员、课堂任务、回执、发布快照和班级时间戳。该套件同时覆盖重复入班、重加入、历史成员和任务阻止删除、仅有旧成员数组时允许删除、归档与归属拒绝、重复发布。公开结果由 [API Classrooms](./handoff-backend-api-map.md#classrooms) 维护。

该套件通过默认连接的目标写入屏障，覆盖编辑与归档的两种顺序、删除先于兼容 POST archive、成功编辑后删除，并核对归档回执名称和课程摘要、正式 GET 和独立 Mongo 终态。
同一屏障还覆盖显式原名随归档写入，以及并发重复归档保留首次写入的时间戳。

环境复用本地 `standard_test` 门禁，验证默认连接和事务连接的实际库名及事务可提交后才写入本批夹具。仅使用既有索引。即使断言失败也释放暂停点并等待在途请求，再按本批班级归属清理及回读关联记录，覆盖未取得回执的写入。

从 `backend` 目录在独立 `standard_test` 进程执行。Discovery 必须只命中该文件。

```powershell
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/classroom-lifecycle.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/classroom-lifecycle.e2e-spec.ts
```

### 课堂提交冷却定向验收

既有 `test/classroom-task-submission-cooldown.e2e-spec.ts` 使用正式 configureApp、HTTP 路由及 Mongo 回读，负责同一作用域正冷却并发的单条受理与等待字段、零冷却的独立尝试编号、不同作用域隔离、顺序提交及窗口过去后的后续提交，并复用同批 fixture 验证禁止迟交和课程/班级非空删除的公开错误投影。提交后响应读取失败使用受控故障，真实数据库回读验证只保留一份作品及一次父实例版本更新。作用域与重试边界见 [Service Card 08](./handoff-backend-service-map.md#service-card-08)，公开字段与单位见 [DTO Submission](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)，状态/业务码见 [API Map](./handoff-backend-api-map.md)。受控时钟、确定性的目标编号竞争、三轮耗尽及无关 E11000 由 LearningTasksService unit 承担。状态/code 配对与内部字段脱敏由 AllExceptionsFilter unit 承担。

环境与身份复用[认证与凭据生命周期定向验收](#认证与凭据生命周期定向验收)，业务测试关闭自动建索引；写 fixture 前读回现行 Submission 作用域唯一索引，仅缺少该索引且对应 Submission 测试集合为空时按正式 Schema 精确补齐并复核，定义冲突不删除/替换或全库同步。该准备不代表生产索引已核查；按本轮合成学生、实例及归属回查实际提交并精确清理，覆盖未取得响应 ID 的写入。

从 `backend` 目录在独立 `standard_test` 进程使用现有 `test:e2e` 入口，先确认 discovery 仅命中既有冷却 spec，再以相同路径定向执行：

```powershell
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/classroom-task-submission-cooldown.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/classroom-task-submission-cooldown.e2e-spec.ts
```

### import-users 定向离线回归

`scripts/import-users.spec.ts` 与 `scripts/import-users-csv.spec.ts` 使用正式导入逻辑，数据库用途为 `none`：只允许合成输入、测试自有临时配置、fake connection/model 和隔离的无网络 CLI 子进程，不连接任何真实数据库，不加载机器真实 `.env` 或继承真实 Mongo、AI、SMTP 凭据，不启动 AppModule 或业务服务。连接替换必须在任何网络连接前生效；临时目录与子进程由创建它们的测试在 teardown/finally 中收口。

纯 CSV 测试负责合法引用/换行、严格语法拒绝、物理行号及表头查找；fake connection/model 测试负责配置优先级、声明与实际库名门禁、模型建立顺序、dry-run 写路径隔离、正式邮箱校验、状态/密码版本轮换、版本限定双类撤销、更新统计及连接关闭。隔离 CLI 入口测试验证 `--help` 无环境/文件/连接依赖、原始环境缺失时拒绝、模块导入不自动执行，以及失败退出与日志脱敏；这些证据证明控制流和调用边界，不证明真实 MongoDB 终态。产品 `--dry-run` 仍可查询目标数据库，不能将测试的 `none` 边界当作产品配置。

从 `backend` 目录先 discovery，结果必须恰好为这两个文件；通过后使用相同显式文件列表正式运行：

```powershell
npm.cmd run test -- --listTests --runInBand --runTestsByPath ./scripts/import-users.spec.ts ./scripts/import-users-csv.spec.ts
npm.cmd run test -- --runInBand --runTestsByPath ./scripts/import-users.spec.ts ./scripts/import-users-csv.spec.ts
```

真实导入 Store 的凭据轮换、状态保留和撤销终态由上节认证 HTTP/Mongo spec 使用正式 `importUsers/createMongooseStore` 验证，独立连接经门禁后使用并在 finally 关闭。真实 dry-run 的文档与元数据不变须由对应实库断言证明，不得从 fake 或离线通过推断。CLI 配置来源、数据库映射与重置副作用由 [Config Matrix](./handoff-backend-config-matrix.md#import-users-独立导入-cli) 维护。

### sync-indexes 定向验收

产品合同由 [Config Matrix](./handoff-backend-config-matrix.md#sync-indexes-普通索引同步) 维护。离线回归与真实数据库集成分别使用独立进程。

**离线回归。** `scripts/sync-indexes.spec.ts` 使用 purpose `none`。只使用合成配置和无网络替身，连接替身与网络阻断在任何网络动作前生效。覆盖 CLI、库名和支持范围门禁、预览零写入、删除授权、逐项执行和首错停止、UUID 漂移叠加索引错误时的诊断、统一末尾验收、退出码与资源回收。capped 门禁使用合成元数据覆盖初始盘点、写前复查和最终回读，证据范围仅限离线控制流。真实 BSON、未连接驱动对象、正式 Schema 克隆及受控输出流用于验证解码、比较、特殊定义拒绝和报告降级。共享的测试生命周期逻辑配合可控 Promise 验证超时停止和清理门禁。这些证据验证控制流、调用边界和数据处理。

Submission 旧索引使用明确的历史 metadata fixture；历史 Schema 等价比较仅向测试自有 clone 添加旧声明，不污染正式 Schema。保留 null/$eq:null、ObjectId 类型等价、非法 partial 和原始定义漂移拒绝回归，并验证当前正式 Schema 不再计划创建旧索引、存量旧索引仍可进入删除计划。历史 partial 的运维识别合同仍由 Config Matrix 维护，不代表恢复无课堂关联的提交业务兼容。

从 `backend` 目录先运行 discovery，确认仅命中下列文件后使用相同路径执行。

```powershell
npm.cmd run test -- --listTests --runInBand --runTestsByPath ./scripts/sync-indexes.spec.ts
npm.cmd run test -- --runInBand --runTestsByPath ./scripts/sync-indexes.spec.ts
```

**真实数据库集成。** `test/sync-indexes.e2e-spec.ts` 使用 purpose `standard_test` 和现有 `test:e2e` runner。独立进程只从 `backend/.env.test` 读取 `MONGO_URI`，目标限于本机单节点副本集 `rs0` 上的 `eduforge_test`。URI 须声明 `replicaSet=rs0`，驱动解析后须恰有一个 loopback seed，并符合正式 CLI 对 `directConnection` 的限制。在驱动进行副本集发现前，测试用独立直连探针安全核验 seed。准备、正式 CLI 连接和清理前均复核实际库名、选中地址、本机唯一公布成员、可写 PRIMARY 以及 `root@admin` 身份和角色。同端口的 `127.0.0.1` seed 和 `localhost` 公布地址可指向同一本机成员。通过正式 Schema 克隆映射到本轮唯一前缀的专属集合，调用正式 CLI 的连接、盘点、执行及验收路径。HTTP 应用和其他业务服务均不启动。

测试期限早于 Jest 外层超时，停止后禁止发起新的测试写入。`afterAll` 从入口计算独立的清理总预算，早于 Jest 的 90 秒期限，覆盖在途调用收束、目标核验、归属查询、删除、残留报告与连接关闭，并为报告和关闭保留时间。确认已发出的写命令结果与实际目标后，每次删除分别在集合名称及 UUID 归属查询前、查询返回后且发出删除前检查期限。到期停止发起新删除，已发出的删除按实际完成或未确认记录。删除未确认时保留登记，残留或连接关闭无法确认时如实报告。超时、Promise 拒绝或关闭连接本身均不足以证明服务端已取消写入。清理期限及未确认状态使用受控时钟和 Promise 做离线回归，实库验收覆盖正常收尾。

该 spec 核对缺失集合及索引的真实补建、Session tokenHash 唯一索引与 TTL、Submission 现行实例部分唯一索引及旧专用索引默认不存在、再次执行无变更、重复 tokenHash 导致部分成功后的验收，以及集合重建前后的真实 UUID；重复键夹具显式提供相同合成 hash，不用缺字段 null 冒充唯一性验证。旧索引退役场景仅在测试专属 Submission 集合显式创建历史索引，验证零写入预览、未授权拒绝、授权后仅删除该索引及再次空计划；保留索引以写前保存的原始元数据核对，覆盖其余 Submission 索引和其他测试模型索引。该场景不清理开发库、生产库或普通测试业务集合的旧索引。写前 UUID 漂移的确定性停止、BSON 精度和难以稳定制造的故障由离线回归负责。生产拓扑、唯一约束空窗、并发写入、复制延迟及真实网络超时均在本组验收范围之外。

在独立 PowerShell 子进程中从 `backend` 目录执行。discovery 必须恰好命中指定 spec，随后使用相同文件路径正式运行。

```powershell
$env:NODE_ENV = "test"
$env:EDUFORGE_DATABASE_PURPOSE = "standard_test"
Remove-Item Env:MONGO_URI, Env:MONGO_ADMIN_URI, Env:BROWSER_ACCEPTANCE_APP_MONGO_URI, Env:BROWSER_ACCEPTANCE_ADMIN_MONGO_URI -ErrorAction SilentlyContinue
npm.cmd run test:e2e -- --listTests --runInBand --runTestsByPath ./test/sync-indexes.e2e-spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath ./test/sync-indexes.e2e-spec.ts
```

目标配置、权限或本地服务不可用时，真实数据库验收记为 `not_executed`。实际执行结果及清理核验见任务验收记录。

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

本机共用账号及 Browser 单一 `MONGO_URI`、实际认证门禁以 Config Matrix 为准；APP/ADMIN 仅表示独立进程职责。Browser 运行仍须分别通过连接声明、实际库名及认证身份/权限核验，同一 URI 不合并下述进程边界。

Browser 相关进程角色边界：

| 进程 | Database purpose | 连接与进程职责 |
|---|---|---|
| Playwright / Browser runner | `none` | 不得直接获得或连接 Mongo URI |
| Browser backend | `browser_acceptance` | 通过独立 `start:browser-test` launcher 从 Browser 专属文件取得 `MONGO_URI`，只承担 APP 应用职责 |
| 文本教学任务 `process-ai` | `browser_acceptance` | 独立 APP 应用上下文；不 listen、不启动 Worker，只在独占验收时段消费唯一合格目标，见 §6.2 |
| 文本教学任务 `prepare/inspect/cleanup/replace` | `browser_acceptance` | 独立 ADMIN 管理进程；不导入 AppModule，不与 HTTP backend 或 Browser 合并，见 §6.2 |
| 窄认证 `prepare/inspect/cleanup` | `browser_acceptance` | 独立 ADMIN 管理进程；仅维护两名 namespace 账号、认证关联清理及限定 Session 索引前置，见下文 |

Browser launcher foundation 负责受控启动、正常初始化所需索引元数据和公开 `GET /api` 健康请求，本身不创建业务数据或证明师生 UI。文本教学任务另有 §6.2 的专用支持，供真实前后端 Agent-assisted smoke 使用；这不构成扩张通用 fixture 框架的理由。

普通 HTTP E2E 使用独立 `NODE_ENV=test` 子进程，purpose 显式指定或默认解析为 `standard_test`；仅提供 `backend/.env.test`，启动前清除 shell 残留的主连接、管理连接和 Browser 变量，不与 Browser env 叠加。URI 声明门禁在连接前执行，Mongoose 实际 databaseName 在连接后验证；Browser launcher 在 AppModule 导入前和 listen 前分别执行门禁，错误立即拒绝。HTTP E2E 不得连接 Browser、development 或 production 数据库；Browser backend / 管理进程不得连接 standard_test、development 或 production 数据库。

最低充分证据入口（执行状态以当次报告为准）：

- `src/config/database-purpose.spec.ts`：purpose/URI/connected-name、Browser 单 URI 声明、环境隔离与 launcher 静态合同；先 `npm run test -- --listTests --runInBand --runTestsByPath ./src/config/database-purpose.spec.ts`，确认唯一目标后去掉 `--listTests` 执行。
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
- 正常、调试及 CI 均须执行原有 scoped cleanup，不提供主动跳过模式。零残留覆盖本轮业务、认证及关联数据；从空库开始的独占测试窗口结束后应恢复零文档，集合和索引可以保留。清理失败、进程中断或结果未知时如实报告，必要恢复记录保留至资源确认收尾。
- 写入超时或连接结果未知时不得直接重跑；先只读核对 app、数据库和任务 namespace 的实际状态。
- 第 5 节的 Browser Acceptance foundation 不自动要求 fixture、verifier 或 cleanup 资产；只有 Browser 持久写入或复杂跨进程终态无法由已有低层证据充分证明时，才允许评估新资产。

认证和文本 Browser 夹具 CLI 正常返回或抛错时，经 `finally` 等待连接关闭。120 秒 watchdog 触发时会尝试输出 `sideEffects: "unknown"`，再用 `process.exit(124)` 直接退出。此路径无法保证执行 `finally`，也无法据此确认已发操作、写入或者清理的终态。退出码 `124` 也可能来自正常错误处理。遇到硬退出或缺少完整收尾证据时，保留恢复记录，先核对自有进程、连接、在途操作及对应 namespace 的实库状态，确认归属和终态后再决定是否清理。

使用共享原生命令助手的夹具写入显式发送合并后的写关注。操作级 `w` 和 journal 设置优先，写确认期限取已有正值和本次剩余预算的最小值。未确认的结果或写关注错误按结果不明处理。

`test/submission-edit.e2e-spec.ts`、`test/classroom-ai-learning-analytics.e2e-spec.ts`、`test/classroom-text-task-contract.e2e-spec.ts` 和 `test/learning-tasks.ai-feedback.bailian-context.e2e-spec.ts` 使用独立 `standard_test` 进程，并在真实连接后同时核对 `authenticatedUsers` 与 `authenticatedUserRoles`，按 [Config Matrix](./handoff-backend-config-matrix.md#1-数据库连接串与索引治理) 确认本机 root 账号，不能只凭 URI 或角色名称通过门禁。按文件串行运行，正常初始化可建立集合和索引元数据；业务写入及 cleanup 限于各 spec 的合成 namespace、记录 ID 和关联资源，清理后核对残留并关闭自有 app/连接，不清空整个数据库。

fixture、verifier、support 与 Browser infrastructure 的通用复杂度止损遵循 [Codex instruction spec](../codex-instruction-spec.md) §3.10；本节只维护当前 EduForge 测试资产与 lifecycle 事实，不建立额外治理体系。

完全隔离于 production 和真实用户的 synthetic application test account（例如测试专用 teacher/student 用户名与密码），只有同时满足以下条件时，才可作为 tracked deterministic test constant：仅存在于测试数据库；不复用生产账号或真实个人密码；不提供基础设施权限；不能取得 Mongo、API、SMTP 或其他外部 Secret 能力。此类凭据是被测应用的普通测试常量，不是 infrastructure Secret。

Mongo password、production credential、Bailian API Key、SMTP password、第三方 service credential 与真实用户 credential 始终属于 Secret，不得 tracked、写入日志或报告。synthetic application credential 的有限规则不得用于放宽这些 Secret 边界。

### ZIP 资料证据与夹具

- `test/learning-tasks.ai-feedback.bailian-context.e2e-spec.ts` 定向执行引用持久化、有效引用重验及两个校验后替换用例。后两项在真实 ZIP 校验完成后控制交错，经正式 PATCH 或 publish、独立 GET 与 Mongo 回读验证引用变化的处理。先用 `test:e2e -- --listTests --runInBand --runTestsByPath` 确认该 spec，再用相同路径和 `-t` 核对定向标题与实际执行数。
- `learning-tasks/ai-context` unit 负责真实 yauzl 精确读取与顺序、路径/realpath、格式/编码/CRC、声明/实际字节保护及关闭；用固定 stdlib ZIP 夹具与已知正文作独立 expected，两个维护中的第14章教材包仅只读核验，不以 reader 输出生成 expected。
- DTO / classroom-task-content / prompt / Processor unit 分别负责嵌套白名单及 null、快照深复制与公开投影、参考/作品分区和不可执行指令、资料错误在 stub/Provider 前终止。既有 budget/provider unit 继续证明实际 messages 计量、等于上限允许及请求预留前拒绝。
- 扩展既有 classroom text contract 与 Bailian context HTTP E2E，证明正式 API 白名单/持久化、最终生效引用验证与无部分写入、候选快照固定、成员投影、实际 mock HTTP 请求包含多包材料、异步资料失效/输入超限及作品保留。需要 Job 的正常场景在提交后由有权师生通过正式 request API 携带实际 expectedRevision 手动申请，不用自动触发或直接造 Job 代替产品链。它们不证明 Browser、真实模型质量或课堂效果。
- 固定 ZIP 位于 `backend/test/fixtures/ai-context`；异常只作用于 spec-owned 临时目录副本，使用实例级窄范围读取根注入，不引入产品配置。HTTP 上下文继续使用 standard_test、Worker=false、mail=log；Bailian context spec 使用自有本地 mock HTTP server 和 `AI_FEEDBACK_DEBUG_ENABLED=true`，不调用真实百炼。每次消费前拒绝外来 PENDING/FAILED/RUNNING；finally 精确清理自有数据、Session、临时 ZIP、mock/Nest/DB，并验证残留，不修改真实教材或全库清空。

### AI 反馈指令、文本收敛与本地诊断

- prompt unit 使用合成任务核对 rubric 原文、实质维度覆盖、允许工具协作、局部来源声明范围、材料存在与本人归属的区分，以及有限肯定和必需缺项边界；包含自然语言 rubric.notes 与缺 rubric 的任务依据。行为职责见 [Provider Card B](./handoff-backend-service-map.md#provider-card-b)，合成示例及字符串单测只证明指令表达与传递，不能证明模型实际遵循。
- Provider unit 以 fake fetch 返回固定多段反馈，经真实 Provider、normalizer 与 compactor 链路核对维度段落、依据和边界原文保留；compactor unit 继续负责无 suggestion 的肯定、展示分段/缩进、空白比较键及既有严重度、同类合并和条数回归。这些证据只证明协议及正式链路的文本保真，不证明真实模型反馈质量。
- Provider / request-body-dumper unit 以 fake fetch 触发实际发送边界，读回请求文件逐字节比较 `fetch.body`，核对合成材料完整且不含请求头凭据；响应诊断与同次 `response.text()` 的固定原字符串比较，分别核对协议校验、normalize 和 Provider 条数收敛阶段，不把诊断当作网络原始 bytes。
- Processor unit 以 mock claim、Provider 和持久化核对同次调用关联、claim 核验及 compactor input/output；合并文件只证明持久化前候选，不证明数据库落库。覆盖成功、合法空结果、失败或未到达阶段的 null/到达标记，以及独立 Provider 不伪造合并阶段；fake fetch/mock 只证明诊断链，不证明模型质量或真实数据库终态。
- 文件诊断回归覆盖关闭/环境门禁、预检及预算/预留拒绝不落盘、三类文件同 stem、请求保存失败后的关联、独占创建不覆盖、并发隔离与源码/dist 的 cwd 独立定位；验证请求 I/O 在 HTTP timer 前、响应/合并 I/O 在清理后，且写入失败不改变业务结果、usage、重试或请求次数。
- 文件系统测试只写各自创建的仓库内 `.local/deliverables/` 唯一临时目录（请求/Provider 使用 `.tmp-ai-request-tests-`，Processor 使用 `.tmp-ai-processor-diagnostics-` 前缀），在 teardown/finally 中精确清理自有目录，不读取或删除已有真实留存；不加载真实凭据、不创建 AppModule 或数据库连接、不调用真实模型。合成参考通过不代表真实课堂资料已抓取核验；运行配置合同见 [Config Matrix](./handoff-backend-config-matrix.md#实际发送边界请求体留存)。
- “第14章 12 项资料真实模型质量复核”已完成，教师已确认本次真实模型反馈符合该任务的评阅要求。真实模型质量以实际请求、响应及最终反馈的人工复核为依据；合成示例、字符串单测和 fake fetch 仅证明各自工程合同，不能单独替代真实模型质量复核。

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

- 每次调用为独立进程，仅读取 `backend/.env.browser-acceptance` 中的 `MONGO_URI` 与 purpose，复用环境构造、用途/URI 声明门禁和连接后实际库名门禁；实际认证按 [Config Matrix](./handoff-backend-config-matrix.md#1-数据库连接串与索引治理) 的本机 root 门禁核验，不以进程角色名称推断数据库账号。
- `prepare` 只通过当前 UserSchema 和密码 helper seed namespace 专属 teacher/student；固定合成应用密码由脚本测试常量统一维护。课程、班级、四个不同已发布私有模板及入班走前端同源 BFF 的正式 HTTP API；模板数量、标题及 ownership 由脚本本地稳定 fixture 标识维护，不依赖业务策略枚举；旧策略标题仅作为历史 namespace 的精确 cleanup 兼容标识，不用于 inspect/process。课堂发布、作品提交、产品 AI 申请和教师反馈留给真实 Browser。
- `inspect --prepared` 只读核验账号固定值及最小前置；普通 `inspect` 读取 ownership 限定的资源、保存原文版本及 Job/反馈终态。异常前置不自动修复。确需替换时显式运行 `npm run browser:text-smoke -- replace --namespace b1-2-<unique> --confirm-namespace b1-2-<unique>`：先清理并核对旧残留，再重新准备；不得手工改密码或业务状态绕过核验。
- `process-ai` 在 Browser 专属文件的用途与单 URI 声明门禁通过后才动态导入 AppModule，以 `createApplicationContext` 启动且不 listen；实际 ConfigService 必须为 Browser 用途、stub、worker=false、debug=false，实际数据库名与 APP 连接的认证门禁也须匹配。正常索引初始化仍可能写入数据库。
- 处理前核对 Job→Submission→ClassroomTask→合成师生/班级的完整 ownership；全库 PENDING/FAILED/RUNNING 必须恰好只有目标，且为 budgetVersion=1、PENDING、attempts=0。外来、多目标或 legacy 非终态立即拒绝，不修改它们。随后只调用真实 `AiFeedbackProcessor.processOnce(1)` 一次，读取该目标及实际 stub 反馈核对结果，finally 等待上下文关闭。
- `processOnce` 是全库扫描入口，上述查询不是并发锁。操作者必须独占验收时段，排除其他 Worker/Profile/生产者并串行形成、消费目标；`--confirm-exclusive` 记录的是该运行前提，不能代替隔离审计。不启用长期 Worker、debug HTTP 或真实模型。
- 最小恢复记录仅保存 namespace、端口、准确资源 ID，位于仓库根目录下 ignored `.local/deliverables/browser-text-task-smoke/<namespace>.json`；Cookie 仅在准备过程内存中使用，不持久化 Cookie、Session、Mongo URI 或基础设施凭据。`.local/deliverables/` 包含恢复资料，不能整体当作可清空缓存。
- CLI 使用单调时钟的 120 秒总截止。HTTP 请求最多 15 秒，ADMIN 数据库操作按原操作预算和总截止的剩余量取较小值。正常收尾、watchdog 和结果不明的核对规则见 [§6.1](#61-current-state)。
- 清理前停止本轮写入与处理并等待在途动作结束。cleanup 使用准确 ID 和关联 ownership，顺序为 Feedback/Job → Submission → ClassroomTask/Task → Enrollment/Classroom/Course → 合成用户 Session/必要 PasswordResetToken → User；拒绝仍在 RUNNING 的自有 Job，不 dropDatabase、不清空集合。完成后核对业务与认证关联残留为零；同一 namespace 的 cleanup 可安全重复，恢复记录在确认资源收尾后再删除。
- 支持纯测试为 `scripts/browser-text-task-smoke.spec.ts`；沿第 4 节 Jest runner 用相同目标参数先 discovery，再执行。它只证明新增门禁、ownership、固定密码和 cleanup 选择，不证明真实 Browser 流程。

### 窄认证 Smoke 支持

`scripts/browser-auth-smoke.ts` 为认证页面的 Agent-assisted 验收提供独立 ADMIN 起点，不建立课程、班级或教学任务。从 `backend` 目录使用已安装的 ts-node/tsconfig-paths，依次执行：

```powershell
node -r ts-node/register -r tsconfig-paths/register ./scripts/browser-auth-smoke.ts prepare --namespace auth-batch2-<unique>
node -r ts-node/register -r tsconfig-paths/register ./scripts/browser-auth-smoke.ts inspect --namespace auth-batch2-<unique>
node -r ts-node/register -r tsconfig-paths/register ./scripts/browser-auth-smoke.ts cleanup --namespace auth-batch2-<unique>
```

- CLI 仅解析 `.env.browser-acceptance`，复用 Browser 环境构造与用途门禁。连接后核对实际库名、实际连接节点为本机单节点 `rs0` 的可写 PRIMARY，以及唯一 `root@admin` 认证身份和角色。导入模块不执行 CLI，也不导入 AppModule。每次运行使用单调时钟的 120 秒总截止，查询、写入和索引盘点按各自操作预算与总截止的剩余量取较小值。一次索引游标的所有批次共用一个操作期限。正常收尾与 watchdog 见 [§6.1](#61-current-state)。
- `prepare` 不覆盖已有恢复记录或 namespace 账号。须先由操作者确认 APP 和其它认证写入者均已停止；脚本再次核对认证三集合为空、没有在途认证操作，才盘点并补齐正式 SessionSchema 索引。仅允许删除精确定义为 `{token:1}, unique:true` 的旧 `token_1`；保留正确的 `_id_`、TTL、userId、tokenHash 唯一索引，未知定义或漂移立即拒绝，不调用其它用途的索引 CLI/helper。检查空集合与 currentOp 不代替独占进程审计。
- 随后仅创建 namespace 专属 teacher/student 两名 active 合成账号。初始和改密场景的固定合成密码由脚本常量维护；`inspect` 只读核对 ID/email/role 归属、账号状态和当前凭据是否匹配已知合成状态，不输出密码或哈希。部分准备失败时只清理本次记录且归属已核实的精确目标。
- 恢复记录位于 ignored `.local/deliverables/browser-auth-smoke/<namespace>.json`，仅保存 namespace 和两个 User ID。所有写入结果不明时先检查精确目标，不直接重试；恢复记录保留到收尾明确。
- Browser 完成后先停止自建 APP/Next，再以记录 ID、namespace email 和 role 核验归属，顺序清理 Session、ResetToken、User 并读回零残留。合法改密或账号状态变化不影响 cleanup，cleanup 不校验初始密码或 credentialVersion；遇归属不符停止，不删除外来数据，不删库、不删集合或合法索引。确认清理后移除恢复记录。
- 离线 `scripts/browser-auth-smoke.spec.ts` 使用用途 `none`、合成配置和内存替身，覆盖环境、实际身份、索引定义/漂移、namespace 冲突、部分准备及改密后的精确 cleanup。使用本手册 Jest runner 先 discovery 再定向执行；它不连接数据库、不加载真实环境文件，也不证明 UI 或真实数据库终态。前端合同、真实 SSR HTTP、受控响应和真实 APP UI 的证据职责由 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md) 维护。

### 6.3 Future Admitted Lifecycle

以下合同用于未来按真实风险准入的其他 Browser Profile；当前文本教学专用资产见 §6.2，不表示已建立通用 fixture/verifier/cleanup 框架：

1. **Fixture 准入与边界：**先评估正式 API、已有 test factory / builder 或合法 synthetic seed 能否最低成本形成起点；只有它们不足时才新增专用 fixture。fixture 只构造 legal、minimal、deterministic、synthetic 前置，不得成为第二套产品、业务状态机、catalog / seed 治理或 UI 测试后门，也不得直接改库制造正式产品不可达状态、绕过业务不变量或引入 test-only lifecycle state；只能直接改库形成的状态须回到 [Frontend testing playbook](./handoff-frontend-testing-playbook.md) 的 `internal_corruption_only` 分类与 [Codex instruction spec](../codex-instruction-spec.md) §3.9 重新判断证据必要性。
2. **变更触发：**UI copy、layout、selector、styling 或 visual arrangement 变化本身不触发 fixture / verifier 数据合同变更；只有 DTO、Schema、ownership、role、lifecycle / state precondition、正式 API contract 或 Profile 所需持久业务事实真实变化时，才评估最低充分同步。
3. **Ownership、namespace 与进程角色：**每个 Profile 创建的持久 synthetic resource 必须具有唯一、可识别、可回收的 ownership / namespace，只能修改或清理自身资源；shared、canonical 与其他 Profile 数据默认只读，namespace 不替代 database-level isolation。进程角色继续遵循第 5 节：runner 为 `none` 且不持有 Mongo URI，Browser backend 是 `browser_acceptance` APP 应用进程，fixture / verifier / cleanup 是同用途的独立 ADMIN 管理进程；共用 URI 不允许 APP 与 ADMIN 为方便而混入同一 runner / backend 进程。
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
