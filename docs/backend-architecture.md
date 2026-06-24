# 后端架构规范（NestJS）

本文档定义 `backend\` 后端工程的目录结构、分层职责、命名规范、模块边界与架构演进口径。  
适用于采用 NestJS + Mongoose + MongoDB + TypeScript 的后端工程。  
本文档不承担 Codex 指令模板和 Codex 执行边界职责；Codex 指令结构以 `docs/codex-instruction-spec.md` 为准，Codex 执行规则以 `docs/codex-rules.md` 为准。

涉及后端目录结构、分层边界、公共能力放置位置、跨模块依赖方式、API 风格或数据库治理等架构规则变化时，应同步更新本文档，或在任务的“〖文档同步要求〗”中明确说明。  
普通模块新增、普通接口新增或局部实现修改，不要求机械修改本文档；是否同步文档由具体任务的“〖文档同步要求〗”确定。

---

## 1. 技术栈与版本策略

- 运行时方向：Node.js
- 框架方向：NestJS
- 数据库方向：MongoDB + Mongoose
- 语言：TypeScript
- API 风格：REST 优先；如需引入其他接口风格，应另行补充规范

版本口径：

- 已初始化项目以 `backend/package.json`、锁文件、配置文件、部署环境和仓库实际代码为准。
- 未初始化项目的 Node.js、NestJS、Mongoose、MongoDB 版本由人类开发者明确决定。
- Codex 不得仅依据本文档自行安装、升级、降级或替换依赖版本。
- 依赖治理和版本变更边界以 `docs/codex-rules.md` 为准。

---

## 2. 数据库治理与索引规范引用

后端所有数据库相关行为，包括但不限于以下内容，统一遵循 `docs/database-conventions.md`：

- 数据库命名与环境隔离
- MongoDB 账号与权限模型
- `autoIndex` 策略
- 索引创建、变更与同步流程
- 运维脚本与人工操作边界
- 数据模型与集合命名约定

本文档只定义后端架构层面对数据库访问的职责边界，不重复展开数据库治理细则。  
如与 `docs/database-conventions.md` 存在冲突，以 `docs/database-conventions.md` 为准。

---

## 3. 顶层目录约定（backend/）

推荐的后端顶层目录如下：

```text
backend/
├─ src/
│  ├─ app.module.ts
│  ├─ main.ts
│  ├─ common/
│  ├─ config/
│  ├─ modules/
│  └─ lib/
├─ test/
└─ ...
```

说明：

- `src/modules/`：所有业务模块统一放置位置，可使用 `auth`、`users`、`files`、`notifications`、`<module>` 等通用命名。
- `src/common/`：跨模块复用的通用能力，例如装饰器、守卫、过滤器、拦截器、管道、共享类型。
- `src/config/`：配置加载、配置映射、环境变量校验。
- `src/lib/`：不依赖或少依赖 Nest DI 的纯工具代码。
- 禁止引入 `utils/`、`helpers/` 这类泛化垃圾桶目录。

---

## 4. 业务模块标准结构

每个业务模块应保持清晰边界，建议结构如下：

```text
src/modules/<module>/
├─ <module>.module.ts
├─ controllers/
│  ├─ <module>.controller.ts
│  └─ <module>.controller.spec.ts
├─ services/
│  ├─ <module>.service.ts
│  └─ <module>.service.spec.ts
├─ dto/
│  ├─ create-<entity>.dto.ts
│  ├─ update-<entity>.dto.ts
│  └─ ...
├─ schemas/
│  ├─ <entity>.schema.ts
│  └─ ...
└─ interfaces/ (可选)
   └─ <module>.interface.ts
```

建议优先使用 Nest CLI 生成 `controller`、`service`、`module` 骨架，再按需要补充 `dto`、`schemas`、`interfaces`。  
是否引入额外层次应以实际复杂度为依据，避免为了形式增加无必要的抽象层。

---

## 5. 分层职责边界

### 5.1 Controller

职责：

- 定义路由与 HTTP 协议细节
- 解析请求参数
- 绑定认证、权限与 Guard
- 调用 Service
- 统一接入异常、Pipe、拦截器等请求链能力

约束：

- 不承载业务规则
- 不直接操作 Mongoose Model
- 不拼装复杂业务流程

### 5.2 Service

职责：

- 实现业务规则与流程编排
- 调用 Mongoose Model 或其他数据访问能力
- 处理跨集合查询、聚合与必要的一致性
- 组织输出层需要的派生数据

约束：

- 不写 HTTP response、cookie、header 等协议细节
- 不应返回包含敏感字段的实体，除非明确为内部流程

设计建议：

- 对未来明确会演进为外部服务调用、消息投递、文件处理、后台任务或异步分析的接口，即使当前仅为 stub、mock 或本地实现，也建议保持 `async` 签名，以减少后续演进时的接口变更成本。
- 已确认纯同步且无 IO 演进预期的工具函数，不受此建议约束。

### 5.3 DTO

职责：

- 定义接口输入结构
- 配合 `class-validator` 与 `ValidationPipe`
- 明确 Create DTO / Update DTO 的边界

约束：

- DTO 用于输入契约和校验，不承担业务规则
- 分页、过滤、排序等请求参数应在 DTO 中显式声明

### 5.4 Schema

职责：

- 定义集合字段、索引和基础约束
- 承载必要的持久化层配置

约束：

- 不承载复杂业务逻辑
- 敏感字段默认使用 `select: false` 或通过输出层剔除
- `timestamps`、联合类型、枚举字段、`.lean()` 查询类型安全等技术红线只作原则性提示；具体规则以 `docs/codex-rules.md` 与 `docs/database-conventions.md` 为准

Schema 与查询类型安全原则：

- Schema 字段定义应保持明确，避免依赖模糊推断
- 查询返回对象不得通过 `as any` 绕过类型约束
- Mapper 或 DTO 输出层应显式处理 `_id`、`createdAt`、`updatedAt` 等字段
- 涉及 `.lean()` 查询的类型安全红线，以 `docs/codex-rules.md` 为准

### 5.5 common / config / lib

职责边界：

- `common/` 放跨模块共享的框架能力与共享类型
- `config/` 放配置加载、映射与校验
- `lib/` 放纯工具代码或低耦合基础能力

约束：

- 不得把无法归类的代码随意堆入通用目录
- 模块内专属逻辑优先放回模块内部，而不是提前抽到 `common/`

---

## 6. API 设计规范

总体原则：

- REST API 优先
- 路由使用复数资源名
- 嵌套资源不要过深
- Controller 不拼装复杂业务
- 异常与响应口径应统一

通用示例：

- `GET /resources`
- `POST /resources`
- `GET /resources/:id`
- `PATCH /resources/:id`
- `DELETE /resources/:id`
- `GET /resources/:id/items`

补充约定：

- 分页、过滤、排序参数应在 DTO 中声明
- 动作型接口应谨慎使用；如必须存在，应采用清晰且稳定的资源语义
- 对外接口返回结构应便于前后端协作和测试验证

代码格式说明：

- 代码格式默认以当前项目的 Prettier、ESLint、TypeScript 配置为准
- 如已确认特定写法存在工具链兼容问题，按 `docs/codex-rules.md` 中的工具链兼容性规则处理
- 本文档不重复规定具体格式化禁令

---

## 7. 认证、安全与敏感字段

认证与授权相关口径统一以 `docs/auth-baseline.md` 为准，包括：

- 登录态
- Token / Cookie
- 角色模型
- Guard
- 前后端认证协作方式

安全红线：

- `password`、`token`、`secret`、`credential` 等敏感字段不得出现在普通响应中
- 管理类能力必须有明确 Guard 或权限控制
- 不得绕过统一认证与授权机制

---

## 8. 测试分层与验证引用

后端测试应按分层职责组织：

- `service.spec.ts`：覆盖规则与边界条件
- `controller.spec.ts`：覆盖路由参数、DTO、`ValidationPipe` 和 Service 调用
- `backend/test/*.e2e-spec.ts`：覆盖真实 HTTP、认证、Guard、数据库读写和关键闭环

相关引用：

- E2E 组织、环境隔离与执行口径以 `docs/e2e-testing.md` 为准
- 具体测试执行策略、任务范围内验证和范围外错误处理，以 `docs/codex-rules.md` 为准

本文档只保留架构层面的测试分层说明，不重复展开 Codex 执行规则。

---

## 9. 架构演进与文档同步口径

以下变化通常应同步更新本文档，或在任务的“〖文档同步要求〗”中明确说明：

- 顶层目录结构调整
- 模块标准结构调整
- 分层职责边界变化
- 公共能力放置位置变化
- 跨模块依赖方式变化
- API 风格变化
- 数据库访问职责边界变化

以下情况通常不要求机械更新本文档：

- 普通模块新增
- 普通接口新增
- 局部实现修改
- 不改变既有架构边界的常规开发

---

## 10. 与相关文档的职责关系

- `docs/codex-instruction-spec.md`：定义 Codex 指令的生成结构
- `docs/codex-rules.md`：定义 Codex 执行边界、依赖治理、验证规则、Mongoose 技术红线和文档同步执行规则
- `docs/database-conventions.md`：定义数据库治理、索引策略与运维边界
- `docs/auth-baseline.md`：定义认证、授权、会话与安全协作口径
- `docs/e2e-testing.md`：定义 E2E 组织方式、环境隔离与执行基线

如出现执行规则与架构说明的重叠或冲突，应以 `docs/codex-rules.md` 的执行规则为准；本文档聚焦后端工程架构本身。

