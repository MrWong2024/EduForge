# E2E 测试规范（End-to-End Testing）

本文档定义 EduForge 后端项目中 **端到端测试（E2E Testing）** 的运行环境、数据隔离规则与执行边界。  
所有 E2E 测试相关行为，必须以本文档为唯一权威依据。

---

## 1. 适用范围（强制）

本规范适用于以下所有场景：

- 本地开发环境中的 E2E 测试
- CI / 自动化流水线中的 E2E 测试
- 任何以 `test:e2e`、`jest-e2e` 等方式运行的端到端测试

**本规范不适用于：**

- 单元测试（unit test）
- 模块级集成测试（integration test）

---

## 2. 运行环境约束（强制）

### 2.1 NODE_ENV 约束

- 所有 E2E 测试 **必须** 在以下环境变量下运行：
`NODE_ENV=test`

禁止在 development 或 production 环境中运行任何 E2E 测试。

### 2.2 测试配置加载规则

E2E 测试运行时，必须加载 测试环境配置（例如 .env.test）。
配置加载、环境变量解析与优先级规则，必须遵循后端统一配置体系及数据库治理规范。

相关强制引用文档：
docs/database-conventions.md

## 3. 测试数据库隔离（强制）

### 3.1 数据库隔离原则

E2E 测试 必须 使用与开发 / 生产环境完全隔离的 测试数据库（test database）。

测试数据库不得与 dev / prod 共享：

- 数据库名称
- 用户账号
- 连接串
- 数据文件或物理实例

### 3.2 可验证性要求（Fail Fast）

应用在 E2E 启动时，必须具备 可验证的隔离机制，用于确认当前连接的数据库属于 test 环境。
若检测到以下任一情况，测试应立即失败（fail fast）：

- 连接到非 test 命名约定的数据库
- 连接到 dev / prod 环境数据库
- 无法确认数据库环境归属

## 4. 测试数据生命周期管理

### 4.1 默认模式（自动清理｜推荐）

默认情况下，E2E 测试应在 测试结束后自动清理测试数据。

推荐使用场景：
- CI / 自动化流水线
- 日常回归测试
- 多人协作环境

### 4.2 调试模式（保留数据｜仅限本地）

在本地调试场景中，允许临时保留测试数据，以便排查问题。
可通过以下环境变量开启：

`KEEP_E2E_DB=1`

严格限制：
KEEP_E2E_DB 仅允许 在本地调试场景使用
CI / 自动化环境中 禁止 设置该变量
默认行为必须为“自动清理”

## 5. E2E 测试执行方式

### 5.1 默认执行方式（推荐）
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- <spec-file>
```

说明：
<spec-file> 为具体的 e2e 测试文件（例如 learning-tasks.e2e-spec.ts）
未设置 KEEP_E2E_DB 时，测试结束后应自动清理测试数据

### 5.2 本地调试执行方式（保留数据）
```powershell
cd backend
$env:NODE_ENV="test"
$env:KEEP_E2E_DB="1"
npm run test:e2e -- <spec-file>
```

## 6. Jest 运行时约束（强制）
本节用于统一约束 EduForge 后端 **E2E 测试在 Jest 运行时层面的行为**，以避免因默认配置不合理导致的误报失败、调试成本上升或 CI 不稳定问题。

### 6.1 背景说明

Jest 的默认测试超时时间为 **5 秒**。  
在 EduForge 后端工程中，E2E 测试通常涉及以下高耗时操作：

- NestJS 应用完整启动（含模块装配与依赖注入）
- MongoDB 真实连接、账号校验与数据库环境确认
- Session / Cookie 登录闭环
- 异步任务、后台 Worker 或 Job Queue（如 AI Feedback 流程）

在上述场景下，默认 5 秒超时 **无法满足工程实际需求**，  
容易导致以下问题：

- 测试用例逻辑正确，但因超时被误判为失败
- 本地与 CI 表现不一致，降低测试可信度
- 开发者被迫在用例中引入不必要的 hack（如拆测试、绕流程）

因此，有必要对 E2E 测试的 Jest 运行时超时进行统一治理。

### 6.2 强制超时约定

**所有 E2E 测试文件必须显式覆盖 Jest 默认超时时间。**

强制约定如下：
- 每一个 `*.e2e-spec.ts` 文件 **必须** 设置 Jest 超时时间为 **30 秒（30000ms）**

- **推荐写法**：
  - 在文件顶层（`import` 语句之后、任何 `describe()` 之前）调用：

  ```ts
  jest.setTimeout(30000);
  ```

- **允许写法**：
  - 在最外层 `describe()` 内、且不依赖任何条件判断的情况下调用

  ```ts
  jest.setTimeout(30000);
  ```

- **禁止以下写法**：
  - 在 `beforeAll` / `beforeEach` / `test` 内调用
  - 在条件分支中调用（如依赖环境变量）
  - 仅对单个测试用例设置超时（如 `test(name, fn, timeout)`）
  - 依赖 Jest 默认 5 秒超时

### 6.3 测试结构约定（推荐）

- 单个 `*.e2e-spec.ts` 文件中 **允许存在多个 `describe()`**，用于划分**同一业务域下的不同测试子场景**（例如：主流程 / Guard / 并发 / 限流）。
- 每个 `describe()` 必须对应**明确且独立的测试关注点**，禁止因“测试用例过多”而随意拆分。
- 若多个 `describe()` 之间存在**状态共享、隐式依赖或执行顺序假设**，应考虑拆分为多个 e2e 文件。
- 禁止通过 beforeAll / beforeEach 在多个 `describe()` 之间引入或依赖隐式共享状态

### 6.4 AI Feedback Pipeline 测试触发规范（强制）

在涉及 AI Feedback 主链路的 E2E 测试中，必须区分以下两类测试目标：

#### 6.4.1 主链路测试（默认场景）

当测试目标为验证 AI 处理主链路行为（例如）：
- Submission 创建
- Job enqueue
- Processor 执行
- 状态流转（PENDING / SUCCEEDED / FAILED / NOT_REQUESTED）
- Feedback 持久化
- Dashboard / 报表聚合结果

此类测试不得依赖 debug 路由触发处理。

禁止默认调用：
`POST /api/learning-tasks/ai-feedback/jobs/process-once`

原因：
- 该接口受 AI_FEEDBACK_DEBUG_ENABLED 门禁控制
- 默认环境中该门禁应为关闭
- 测试不应因运维门禁策略变动而失效

推荐做法：
- 在测试内部直接调用 AiFeedbackProcessor.processOnce()
- 或通过内部 Service/Processor 触发一次处理批次
- 保证与 Worker 执行路径一致

此规则的目的：
- 避免测试与 debug 门禁耦合
- 保证测试聚焦业务链路
- 保持与生产 Worker 行为一致

#### 6.4.2 Debug / 运维门禁测试（专用场景）

若测试目标为验证：
- AI_FEEDBACK_DEBUG_ENABLED 开关行为
- debug/ops 路由的 404 / 403 逻辑
- 角色权限与门禁叠加行为

此类测试可以调用 debug 路由。

但必须：
- 在测试描述中明确标注为“debug gate 测试”
- 单独成组（describe 分组）
- 不与主链路测试混合

### 6.5 环境变量注入时机规则（强制）

在 E2E 测试中，若某个环境变量会影响 NestJS 模块装配阶段的行为（即在 `ConfigModule.forRoot()` 或模块初始化期间被读取的配置），例如：
- 是否注册某些路由
- 是否启用/禁用某些 Guard
- 是否挂载 debug/ops 接口
- 是否实例化某些 Provider
- 是否根据配置决定模块结构

则该环境变量 **必须** 在 `import AppModule` 之前设置。

原因：
- `ConfigModule.forRoot()` 在模块装配阶段读取并缓存配置
- 模块树一旦装配完成，再修改 `process.env` 不会影响已注册的路由或 Guard
- 在 `beforeAll()` 中修改环境变量通常为时已晚

#### 正确写法示例：
```ts
import { App } from 'supertest/types';

const previousDebug = process.env.AI_FEEDBACK_DEBUG_ENABLED;
process.env.AI_FEEDBACK_DEBUG_ENABLED = 'true';

import { AppModule } from '../src/app.module';
```

并在 `afterAll()` 中恢复旧值：
```ts
if (previousDebug === undefined) {
  delete process.env.AI_FEEDBACK_DEBUG_ENABLED;
} else {
  process.env.AI_FEEDBACK_DEBUG_ENABLED = previousDebug;
}
```

禁止写法：
- 在 beforeAll() 中设置会影响模块装配的环境变量
- 依赖 PowerShell / Shell 预置环境变量作为测试稳定性的前提
- 在多个测试文件之间共享未恢复的 process.env 修改

本规则适用于以下典型开关（示例）：
- AI_FEEDBACK_DEBUG_ENABLED
- AI_FEEDBACK_WORKER_ENABLED
- 任何影响路由是否存在或模块是否注册的配置项

违反本规则可能导致：
- 测试返回 404 而非预期 403/200
- Debug 路由无法访问
- 测试结果在不同运行方式下不一致

## 7. 禁止事项（红线）

以下行为 **严格禁止**：

- 在 dev / prod 数据库上运行 E2E 测试
- 在 NODE_ENV=development 或 NODE_ENV=production 下运行 E2E
- 在 CI 环境中开启 KEEP_E2E_DB
- 通过修改测试脚本绕过数据库隔离或清理机制
- 任何违反上述红线的行为，均视为 架构违规。

## 8. 文档治理与一致性约定

本文档属于 测试治理级强制规范
后端架构文档（backend-architecture.md）仅作强制引用，不重复定义细节
如与其它文档存在约定冲突：

- 数据库相关规则以 docs/database-conventions.md 为准
- 测试执行与数据生命周期规则以本文档为准

## 9. 变更流程（强制）

任何涉及以下内容的变更，必须同步更新本文档：

- E2E 执行方式
- 测试数据清理 / 保留策略
- CI 中的 E2E 测试行为

未同步更新文档的实现变更，视为无效变更