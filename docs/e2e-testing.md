# E2E 测试规范（End-to-End Testing）

本文档定义后端端到端测试的运行环境、数据库隔离、测试数据生命周期、Jest 运行时、启动期配置注入、执行方式与测试边界。  
适用于采用 NestJS + Jest + Supertest + MongoDB/Mongoose 的后端工程。  
本文档不定义具体业务流程、具体业务接口或具体业务测试用例；具体业务链路测试由对应模块的 E2E 用例定义。  
Codex 执行边界和验证策略以 `docs/codex-rules.md` 为准；数据库隔离与数据库治理以 `docs/database-conventions.md` 为准；认证与会话测试原则以 `docs/auth-baseline.md` 为准。

---

## 1. 适用范围

本规范适用于：

- 本地开发环境中的 E2E 测试
- CI / 自动化流水线中的 E2E 测试
- 通过 `test:e2e`、`jest-e2e` 或项目等价命令运行的端到端测试

本规范不适用于：

- 单元测试
- 模块级集成测试

### 1.1 与 service / controller 测试的关系

- `service.spec.ts` 优先覆盖业务规则、状态机、边界条件、聚合统计、复杂优先级和副作用
- `controller.spec.ts` / DTO validation 优先覆盖 query 参数、DTO 字段、`ValidationPipe`、默认值和参数传递
- E2E 覆盖真实 HTTP、认证、Guard、全局 Pipe、DTO、数据库读写、模块装配和跨模块关键闭环
- `service spec` 不能替代真实 HTTP 链路测试
- E2E 也不应承载所有规则边界

---

## 2. 运行环境约束

### 2.1 NODE_ENV 约束

- 所有 E2E 测试必须在 `NODE_ENV=test` 下运行
- 禁止在 development 或 production 环境中运行 E2E

### 2.2 测试配置加载

- E2E 应加载测试环境配置，例如 `.env.test` 或项目等价测试配置
- 配置加载、环境变量解析与优先级规则，应遵循后端配置体系和数据库治理规范
- 如果当前环境、数据库名或连接串无法确认属于 test 环境，应 fail fast

相关引用：

- `docs/database-conventions.md`

---

## 3. 测试数据库隔离

### 3.1 隔离原则

- E2E 必须使用与 development / production 完全隔离的 test database
- 测试数据库不得与 dev / prod 共享：
  - 数据库名称
  - 用户账号
  - 连接串
  - 数据文件或物理实例

### 3.2 启动期校验

应用在 E2E 启动时，应具备可验证的隔离机制，至少确认：

- `databaseName` 符合 test 命名约定
- 当前环境为 test
- 当前连接不是 dev / prod

若无法确认隔离条件成立，应 fail fast。

具体数据库命名、账号权限和 production 红线，以 `docs/database-conventions.md` 为准。

---

## 4. 测试数据生命周期管理

### 4.1 默认模式

- 默认行为必须是自动清理测试数据
- 该模式适用于 CI / 自动化环境和常规回归

### 4.2 本地调试保留模式

- 本地调试允许临时保留测试数据
- 可采用环境变量示例：`KEEP_E2E_DB=1`
- 该变量仅作为项目可选约定，实际开关以项目配置为准
- 如果项目尚未实现该开关，不得假设可用
- CI / 自动化环境禁止保留测试数据

---

## 5. E2E 执行方式

Windows PowerShell 示例：

```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- <spec-file>.e2e-spec.ts
```

说明：

- 上述命令仅为示例
- 实际命令以 `backend/package.json` 为准
- `KEEP_E2E_DB` 仅在项目实现了该开关时才可使用
- 是否执行 E2E，以 `docs/codex-rules.md` 和具体任务验收要求为准

---

## 6. Jest 运行时约束

### 6.1 背景

Jest 默认测试超时时间通常为 5 秒。  
E2E 往往包含以下较慢操作：

- NestJS 应用完整启动
- MongoDB 真实连接
- 账号校验与 test 环境确认
- Session / Cookie 登录闭环
- 后台任务、消息队列、外部服务 stub / mock 或异步处理

因此，默认 5 秒可能导致误报失败。

### 6.2 统一超时约定

- E2E 测试应显式设置统一超时时间
- 建议默认值为 `30000ms`
- 推荐写法是在顶层 `import` 之后、`describe` 之前调用：

```ts
jest.setTimeout(30000);
```

允许写法：

- 在最外层 `describe()` 内无条件调用

不推荐写法：

- 在 `beforeAll`、`beforeEach`、`test` 内调用
- 在条件分支内调用
- 仅对单个测试用例设置超时
- 完全依赖 Jest 默认 5 秒

---

## 7. 测试结构约定

- 单个 `*.e2e-spec.ts` 文件可以存在多个 `describe()`
- 每个 `describe()` 应对应明确且独立的测试关注点
- 若多个 `describe()` 之间存在状态共享、隐式依赖或执行顺序假设，应拆分
- 禁止通过 `beforeAll` / `beforeEach` 在多个 `describe()` 之间引入或依赖隐式共享状态

通用关注点示例：

- main flow
- guard
- validation
- pagination
- conflict
- permission
- file export
- background processing

---

## 8. 后台任务、Worker 与 Debug/Ops 路由测试边界

- 当测试目标是验证主业务链路或后台处理链路时，不应默认依赖 debug / ops 路由触发
- 应优先通过内部 service、processor、queue adapter、worker entry 等可测试入口触发一次处理
- 测试应尽量贴近生产路径
- debug / ops 路由只应用于验证调试门禁、运维开关、权限叠加和路由隐藏行为
- debug / ops 测试必须单独成组，不得与主链路测试混合
- 不得将运维门禁开启作为主链路 E2E 的默认前提

通用示例名可使用：

- `BackgroundProcessor`
- `processOnce()`
- `enqueue`
- `worker`
- `ops route`
- `FEATURE_DEBUG_ENABLED`
- `WORKER_ENABLED`
- `PENDING / COMPLETED / FAILED / SKIPPED`

---

## 9. 启动期环境变量注入时机

如果某个环境变量会影响 NestJS 模块装配阶段的行为，必须在 `import AppModule` 之前设置。

典型场景包括：

- 路由是否挂载
- Guard 或 ops 路由开关
- Provider 选择或注册
- Worker 初始化
- 启动时读取并缓存的配置值

原因：

- `ConfigModule.forRoot()` 会在模块装配阶段读取配置
- 模块树装配完成后，再改 `process.env` 往往已经太晚

通用示例：

```ts
const previousFeatureFlag = process.env.FEATURE_DEBUG_ENABLED;
process.env.FEATURE_DEBUG_ENABLED = 'true';

import { AppModule } from '../src/app.module';
```

恢复示例：

```ts
if (previousFeatureFlag === undefined) {
  delete process.env.FEATURE_DEBUG_ENABLED;
} else {
  process.env.FEATURE_DEBUG_ENABLED = previousFeatureFlag;
}
```

禁止做法：

- 在 `beforeAll()` 中设置会影响模块装配的环境变量
- 在多个测试文件之间共享未恢复的 `process.env` 修改

---

## 10. 运行时配置覆写边界

### 10.1 必须在启动前设 env 的场景

若配置会影响以下启动期行为，必须在 `import AppModule` 之前设置 `process.env`：

- 模块装配或模块结构
- Provider 选择 / 注册
- Route / Controller 是否挂载
- Guard 或 debug / ops 路由开关
- `onModuleInit()` 启动逻辑
- 定时器 / worker 初始化
- 启动时读取并缓存的配置值

### 10.2 允许启动后 set ConfigService 的场景

`ConfigService.set(...)` 只适用于运行时重新读取配置的业务逻辑。

允许启动后调用的前提：

- 不影响模块装配、路由挂载、Provider 注册或启动期定时器
- 被测逻辑会在请求处理时或方法执行时重新读取 `ConfigService`
- 配置属于运行时阈值或运行时开关，而不是启动期结构性配置

### 10.3 默认策略

若无法确认配置是启动期读取还是运行时现读，默认按更稳妥方式处理：

- 在 `import AppModule` 之前设置 `process.env`

通用配置示例：

- `FEATURE_DEBUG_ENABLED`
- `WORKER_ENABLED`
- `ENABLE_OPS_ROUTES`
- `FEATURE_X_ENABLED`

---

## 11. 认证与权限 E2E 原则

- 未认证访问受保护接口应返回 `401`
- 已认证但无权限应返回 `403`
- 公共接口应可在未登录状态访问
- 登录成功后应能通过认证探针或受保护接口确认登录态
- logout 后原 Cookie / session 不应继续访问受保护接口
- 敏感字段不应出现在 E2E 响应断言允许的输出中
- 具体认证、Cookie、Guard 和角色规则以 `docs/auth-baseline.md` 为准

---

## 12. 测试数据与断言原则

- 测试数据应由测试用例显式创建，不依赖本地手工数据
- 测试用例应避免依赖执行顺序
- 测试断言应验证：
  - HTTP status
  - 响应结构
  - 关键字段
  - 数据库副作用
  - 权限与数据隔离
  - 错误语义
- 避免过度断言完整响应，降低无关字段变化导致的脆弱性
- 时间字段断言应使用范围、存在性或格式断言，不要依赖固定时间值
- ID 字段断言应验证存在性、格式或关联关系，不要依赖硬编码 ID

---

## 13. 外部服务边界

- E2E 不应默认真实调用第三方服务、短信、邮件、支付、模型服务、对象存储、会议平台或其他外部系统
- 外部服务应通过 mock、stub、fake adapter、测试 Provider 或测试配置隔离
- 如必须进行真实外部集成测试，应单独标记、单独运行，并默认不进入普通 E2E
- 外部服务凭证不得写入仓库
- 不得因为外部服务不可用导致普通 E2E 不稳定

---

## 14. CI 与本地调试边界

CI 中默认应满足：

- `NODE_ENV=test`
- 使用 test database
- 自动清理数据
- 不保留 `KEEP_E2E_DB`
- 不依赖本地手工环境
- 不调用真实外部服务

本地调试允许：

- 定向执行单个 E2E 文件
- 临时保留测试数据
- 打印必要调试日志
- 使用本地测试数据库

补充原则：

- 本地调试配置不得作为 CI 默认行为
- CI 稳定性优先于调试便利

---

## 15. 文档同步口径

以下变化通常应同步更新本文档，或在任务的“〖文档同步要求〗”中明确说明：

- E2E 执行方式
- 测试数据库隔离方式
- 测试数据清理 / 保留策略
- Jest 超时基线
- 启动期配置注入约定
- 外部服务隔离方式
- CI 中的 E2E 行为

普通测试文件新增或局部断言调整，通常不要求机械更新本文档。

---

## 16. 与相关文档的职责关系

- `docs/codex-instruction-spec.md`：Codex 指令结构
- `docs/codex-rules.md`：Codex 执行规则、验证边界、不得修复范围外错误
- `docs/backend-architecture.md`：后端架构、模块分层、Service / Controller / DTO / Schema 职责
- `docs/auth-baseline.md`：认证、sessions、Cookie、Guard、安全错误语义
- `docs/database-conventions.md`：数据库命名、环境隔离、索引治理
- `docs/frontend-architecture.md`：前端 BFF、会话协作和 UI 错误处理

如出现内容重叠，应按各文档职责边界理解；本文档只定义 E2E 测试规范本身。

