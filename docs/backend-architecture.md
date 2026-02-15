
# EduForge 后端架构规范（NestJS）

  本文档定义 EduForge 后端（NestJS）的目录结构、分层职责、命名规范与开发流程。  
  本仓库以本文档为准绳：任何新增模块、重构、目录调整，必须先更新本文档，再改代码。  

---

## 1. 技术栈与版本策略

  - 运行时：Node.js LTS（24.x）
  - 框架：NestJS 11.x
  - 数据库：MongoDB 8.x（Mongoose）
  - 语言：TypeScript
  - API 风格：REST（优先），后续如需 GraphQL 另立规范

### 1.x. 数据库治理与索引规范（强制引用）

EduForge 后端所有与数据库相关的行为，包括但不限于：

- 数据库命名与环境隔离
- MongoDB 账号与权限模型
- autoIndex 策略
- 索引创建、变更与同步流程
- 运维脚本与人工操作边界

**必须严格遵循以下文档：**

- `docs/database-conventions.md`

约定说明：

- `database-conventions.md` 属于 **架构级强制规范**
- 本文档不重复定义数据库细则，避免规则分散与冲突
- 如两份文档存在约定冲突，**以 `database-conventions.md` 为准**
- 任何违反该文档的实现（包括应用配置、启动参数、脚本行为），均视为架构违规

---

## 2. 顶层目录约定（backend/）

  后端工程目录固定如下，不允许随意增加同级目录（除非在本文档中新增条款并说明原因）：

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

* `src/modules/`：所有业务模块统一放置位置（auth、users、semesters、courses、classrooms…）
* `src/common/`：跨模块复用的通用能力（装饰器、守卫、过滤器、拦截器、管道、接口等）
* `src/config/`：配置加载与校验（环境变量、配置对象）
* `src/lib/`：纯工具代码（不依赖 Nest DI 或少依赖），例如字符串处理、通用校验、时间工具等
* 禁止新增 `utils/`、`helpers/` 这类泛化目录，避免“垃圾桶化”

---

## 3. 业务模块标准结构（强制）

每个业务模块必须遵循统一结构；任何模块都像一个“小型独立 npm 包”，有清晰边界。

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

生成方式（强制建议）：

* controller：`nest g controller modules/<module>/controllers/<module> --flat`
* service：`nest g service modules/<module>/services/<module> --flat`
* module：`nest g module modules/<module>`

说明：

* 允许存在 `interfaces/`，用于模块内专属类型（不对外暴露的内部契约）
* 不建议引入 repository 层，除非明确需要解耦多数据源或复杂查询组合（届时新增条款）

---

## 4. 分层职责边界（必须遵守）

### 4.1 Controller（控制器层）

职责：

* 定义路由与 HTTP 协议细节（path、method、status code、headers）
* 解析请求参数（@Body/@Param/@Query）
* 绑定权限与认证（Guards / Roles）
* 调用 service 执行业务
* 不承载业务规则与数据库访问

禁止：

* 禁止直接操作 Mongoose Model
* 禁止写超过 80 行的业务逻辑（超过说明该下沉到 service）
* 禁止处理复杂异常拼装（交给全局异常体系）

### 4.2 Service（业务层）

职责：

* 实现业务规则与流程编排
* 调用数据访问（Mongoose Model）
* 处理事务性一致性（必要时）
* 形成清晰可测试的业务函数

允许：

* 在 service 内进行数据校验（但输入校验优先 DTO）
* 在 service 内进行跨表/跨集合查询与聚合

禁止：

* 禁止返回“含敏感字段”的实体（例如 password），除非明确设计为内部接口
* 禁止在 service 里写 HTTP 相关逻辑（res、cookie、header）

#### 4.2.x 工具链兼容性写法（强制）

为规避 TypeScript + ESLint 在部分表达式上的解析与类型边缘问题，Service 层在以下场景中 **必须遵循工具链兼容性写法**：

* **`await` + 链式调用场景（如 Mongoose 查询）**
  - 优先采用单行链式调用
  - 避免将链式调用拆分为多行

  推荐：
  ```ts
  const task = await this.taskModel.findById(id).lean().exec();
  ```
  
  不推荐：
  ```ts
  const task = await this.taskModel
    .findById(id)
    .lean()
    .exec();
  ```

* **`map / filter / reduce` 等高阶函数回调为单表达式的场景**
  - 使用单行箭头函数
  - 避免在函数调用参数中换行并使用尾逗号（`trailing comma`）

  推荐：
  ```ts
  items: items.map((x) => this.toDto(x)),
  ```

  不推荐：
  ```ts
  items: items.map((x) =>
    this.toDto(x),
  ),
  ```

#### 4.2.y 异步接口设计约定（设计级约定）

在本项目中，凡是**未来明确会演进为 IO 调用**的接口（例如：AI 模型调用、外部服务请求、异步分析/评分管线、消息投递等），
即使在当前阶段采用 stub / mock / 本地同步实现，也应遵循以下设计约定：

- 接口方法应保持 `async` 签名；
- 方法体内应包含最小的 `await`（例如 `await Promise.resolve()`），以确保异步语义成立；
- 不因当前实现为同步逻辑而去除 `async` / `await`。

该约定的目的在于：

- 保持系统时间模型（Time Model）的一致性；
- 避免后续引入真实 IO 实现时发生接口签名变更；
- 降低异步管线、后台 worker 与调用方的演进与重构成本。

说明：

- 本约定属于**设计层约定**，不作为 lint 级或编译期强制规则；
- 在代码评审、架构评估及自动化生成（如 GPT-5.2-Codex）过程中应予以遵循；
- 若确有同步实现且未来不涉及 IO 的接口，不受此约定约束。

#### 4.2.z Mongoose Lean 查询的类型约束规范（强制）

在 EduForge 后端工程中，Service 层广泛使用 Mongoose 的 `.lean()` 查询以提升性能。
由于 `.lean()` 返回的是 **Plain Object（非 Mongoose Document）**，TypeScript 在以下场景中无法自动推断字段存在性与类型稳定性：

- `_id`
- `createdAt / updatedAt`
- 基于上述字段的派生计算（如时间比较、序列化等）

为避免在 Service 层出现隐式 `any`、类型断言泛滥或运行期风险，特制定以下**强制类型约束规范**。

---

##### 一、公共类型定义（强制使用）

后端统一提供以下公共类型定义：

- `WithId`  
  ```ts
  export type WithId = { _id: Types.ObjectId };
  ```
- `WithTimestamps`  
  ```ts
  export type WithTimestamps = { createdAt?: Date; updatedAt?: Date };
  ```

上述类型统一存放于：
- src/common/types/with-id.type.ts
- src/common/types/with-timestamps.type.ts

##### 二、Mapper / Helper 层的强制约定（A 类场景）

凡是 DTO / Response Mapper / Helper 中访问以下字段之一的：
* `_id`
* `createdAt`
* `updatedAt`

必须在入参类型上显式声明：
```ts
X & WithId & WithTimestamps
```

示例（推荐）：
```ts
toTaskResponse(task: Task & WithId & WithTimestamps) {
  return {
    id: task._id.toString(),
    createdAt: task.createdAt?.toISOString(),
  };
}
```

禁止在 Mapper 层通过 as any、隐式断言或假设字段存在。

##### 三、Service 内局部逻辑的约定（B 类场景）

在 Service 内部的局部计算逻辑（非 Mapper），如：
* latest.createdAt?.getTime()
* (x.createdAt ?? new Date(0)).toISOString()
* _id.toString() 作为 Map key / response 字段

必须采用以下两种方式之一（择一即可）：

* 方式 1：为 .lean() 查询显式指定泛型（推荐）
```ts
const submissions = await this.submissionModel
  .find(...)
  .lean<Submission & WithId & WithTimestamps[]>()
  .exec();
```

方式 2：在局部变量或容器类型上补充类型约束
```ts
const statsMap = new Map<
  string,
  { latest?: Submission & WithId & WithTimestamps; count: number }
>();
```

##### 四、扫描与核查要求（强制）

在新增或重构 Service 代码时，必须进行以下静态核查：
- 扫描所有 .lean() 查询链；
- 扫描所有 _id / createdAt / updatedAt 的访问点；
- 核对是否符合以下规则：
  * A 类（Mapper / Helper）：是否统一使用 X & WithId & WithTimestamps
  * B 类（Service 内局部逻辑）：是否通过泛型或局部类型补齐

未满足上述约定的代码，视为 **类型治理不合规**。

##### 五、设计说明（必须保留）

本规范的目的在于：
* 明确 .lean() 场景下的类型边界；
* 避免类型断言向运行期风险转移；
* 保证 Service 层在复杂聚合、统计与派生计算中的可维护性；
* 为 Codex / GPT 自动化代码生成提供确定性规则。

本规范属于 工程级强制约定，对新增代码与重构代码必须遵守；
历史代码不强制追溯，但在涉及文件调整时应同步修正。

### 4.3 DTO（输入契约层）

职责：

* 定义接口输入结构与校验规则（class-validator）
* 与 ValidationPipe 配合实现白名单过滤与校验错误格式统一

规范：

* Create DTO：字段尽量完整且严格
* Update DTO：使用 PartialType(CreateDto) 或专用 Update DTO（视安全边界决定）
* Profile DTO：用于“用户更新自己资料”等场景，应更严格限制字段范围

#### 4.3.x Query DTO 的数值类型转换约定（强制）

在本项目中，所有通过 URL Query（@Query()）传入的参数，在 HTTP 协议层面均为字符串类型。
为确保 class-validator 在数值校验（如 @IsInt / @Min / @Max）场景下行为一致、可预期，特制定以下强制约定：

##### 强制规则
- 所有 Query DTO 中声明为 `number` 的字段，**必须**显式使用：
  ```ts
  @Type(() => Number)
  ```

该约定适用于但不限于以下常见字段：

- 分页参数：`page`、`limit`、`offset`
- 筛选参数：`stage`、`level`、`score`
- 数值型区间参数：`from` / `to`（如时间戳）

##### 推荐写法示例
```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryExampleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

##### 说明与边界
- 本约定 **仅适用于 `@Query()` DTO**
- `@Body()` DTO：
  - 默认要求客户端遵循 JSON 数值语义
  - **不强制**使用 `@Type(() => Number)`，以避免弱化输入契约
- `@Param()` DTO：
  - 若参数语义为数值类型（而非字符串 ID）
  - 应遵循与 Query DTO 相同的类型转换规则，应遵循与 Query DTO 相同的转换规则

本规则的目的在于：
- 消除 query string 带来的隐式类型差异；
- 避免校验行为随 ValidationPipe 或工具链配置变化；
- 提升接口行为的长期稳定性与可维护性。

### 4.4 Schema（持久化层）

职责：

* 定义 MongoDB collection 的结构（@Schema/@Prop）
* 定义索引（index、unique、compound index）
* 定义必要的 pre-save 钩子（例如密码加密）

规范：

* Schema 文件只放持久化相关逻辑，不放业务规则
* 密码 hash、identifier 自动生成这类“存储前转换”允许存在于 schema pre-save

#### 4.4.x timestamps 字段约定（强制）

当 Schema 启用 Mongoose 的 timestamps 机制时：

```ts
@Schema({ timestamps: true })
```
必须遵循以下约定：

* createdAt 与 updatedAt 由 Mongoose 自动生成并维护；
* 禁止在 Schema class 中显式声明以下字段：
  * createdAt
  * updatedAt
  * 以及 timestamps 自定义映射后的等价字段名；

说明：
* timestamps 生成的字段在 MongoDB collection 中真实存在；
* Schema 中重复声明上述字段会造成语义重复与维护混乱；
* MongoDB 索引可直接使用 createdAt / updatedAt，不依赖 Schema class 中的 @Prop() 声明；

如需表达业务语义时间点，必须使用明确区分的字段名，例如：
* publishedAt
* archivedAt
* deletedAt

### 4.5 代码风格补充规范（Import / Decorator）

#### 4.5.1 装饰器密集型库的 import 约定（强制）

在后端工程中，以下类型的库属于**装饰器密集型库（decorator-heavy libraries）**，包括但不限于：

- `class-validator`
- `class-transformer`
- `@nestjs/swagger`
- NestJS 框架中大量依赖装饰器的相关模块

**工程级强制约定（基于已验证的工具链行为）：**

- 对上述库的 import，**统一采用单行写法**
- 禁止使用多行解构 import（即 `{` 后换行的形式）
- 该约定优先级 **高于 Prettier 的默认格式化行为**

原因说明（必须保留）：

> 在当前 EduForge 工程的 TypeScript / ESLint / IDE 组合环境中，  
> 已验证多行解构 import 在部分场景下会触发解析或编译异常。  
> 为保证代码生成、编译与 CI 行为的确定性，统一收敛为单行 import。

**唯一推荐写法：**

```ts
import { IsInt, IsOptional, Max, Min } from 'class-validator';
```
明确禁止写法：
```ts
import {
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
```
说明：

- 本约定属于**工程稳定性约定**，不是风格偏好；
- Codex / GPT 等自动化代码生成 **必须遵循**；
- 如未来工具链升级并验证问题消失，需通过**文档变更流程**解除该约定。

#### 4.5.2 Prettier 特赦机制（推荐）

在以下场景中，**允许并推荐**使用 `// prettier-ignore` 固定 import 或装饰器相关代码格式：

- 教学示例代码，需要保持结构稳定
- 装饰器参数较多，需要强调可读性与对齐
- 明确已遇到或验证过工具链（TypeScript / ESLint / IDE）解析异常的场景
- `// prettier-ignore` 不得用于绕过 4.5.1 中关于 import 行结构的强制约定；
- 仅允许在 **单行 import 前提下** 固定装饰器或参数排版。

示例：

```ts
// prettier-ignore
import {
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
```

#### 4.5.3 适用范围

* 本规范适用于所有后端业务模块与通用模块
* 对新增代码与重构代码必须遵守
* 对历史代码不强制追溯修改，但在涉及文件调整时建议同步修正

---

## 5. 通用能力规范（common/）

`src/common/` 允许包含以下子目录：

```text
src/common/
├─ decorators/
├─ guards/
├─ filters/
├─ interceptors/
├─ pipes/
└─ interfaces/
```

推荐做法：

* 认证鉴权：guards + decorators（例如 Roles、CurrentUser）
* 错误处理：filters（全局异常过滤器统一输出格式）
* 响应封装：interceptors（如需要统一 envelope 再启用）

> 说明：认证相关 Guard（如 JwtAuthGuard）的职责边界与提供方式，
> 需与 `docs/auth-baseline.md` 保持一致，
> 不得在业务模块中自行装配或变更其提供方式。

---

## 6. API 约定（REST）

### 6.1 路由命名

* 集合：`/users`、`/courses`、`/semesters`
* 子资源：`/courses/:id/classrooms`
* 自身资源：`/users/me`
* 动作型：尽量避免；如确需动作，使用语义清晰的子路径（例如 `/auth/login`）

### 6.2 返回数据

* 默认返回业务数据对象或数组
* 错误统一由全局异常过滤器输出结构（statusCode/timestamp/path/message）
* 不强制 envelope（如 `{ data, message }`），如后续统一再新增条款

---

## 7. 安全与敏感字段红线

* 任何对外接口不得返回 password 等敏感字段
* findByEmail / findOne 等方法如需要 password，必须显式传参 `includePassword=true`
* 登录与刷新 token 的逻辑集中在 auth 模块，禁止散落到其它模块

### 7.x 认证与会话实现说明

关于登录态、会话存储、Cookie 策略、会话失效与清理等**具体实现约束**，
统一以以下文档为准：

- `docs/auth-baseline.md`

任何涉及认证、鉴权、会话生命周期的实现或重构，
**不得与该基线文档冲突**。

---

## 8. 测试规范（最小可行）

* service 必须可单测（至少关键业务流程）
* controller 至少保证路由可用与 guard 绑定正确
* 新增模块时，优先补齐 service.spec.ts 骨架，后续再逐步完善

### 8.x E2E 测试与环境隔离（强制引用）

所有端到端测试（E2E Testing）相关的行为，包括但不限于：

- E2E 测试的运行环境约束（NODE_ENV）
- 测试数据库的隔离策略
- 测试数据的清理与保留规则
- 本地调试与 CI 场景下的差异化执行方式

**必须严格遵循以下文档：**

- `docs/e2e-testing.md`

约定说明：

- `e2e-testing.md` 属于 **测试治理级强制规范**
- 本文档不重复定义 E2E 测试的具体执行细节
- 如两份文档存在约定冲突，**以 `e2e-testing.md` 为准**
- 任何违反该文档的 E2E 测试实现或执行方式，均视为架构违规

---

## 9. 变更流程（强制）

* 新增模块：先按“模块标准结构”生成骨架，再补业务逻辑
* 重构结构：先改本文档，再改代码
* 大变更：必须输出“变更清单 + 影响范围 + 回滚策略”

---

## 10. 给 GPT-5.2-Codex 的执行规则（简版）

* 以仓库现有结构为唯一事实，不得发明新目录
* 新模块必须落在 `src/modules/<module>/` 并符合标准结构
* controller 不写业务逻辑，业务逻辑下沉到 service
* schema 仅做持久化定义与必要的 pre-save 转换
* 不确定时先提出问题与风险，再给可执行方案
* 生成或修改涉及装饰器库（class-validator、class-transformer、@nestjs/swagger）的代码时：
  - 以 Prettier 格式化结果为准
  - 在需要固定格式的场景下，允许使用 `// prettier-ignore`，并遵循第 4.5 节说明

````

