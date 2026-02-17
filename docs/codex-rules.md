### Agent 执行规则（强制）

所有涉及目录结构、基础设施、跨模块修改的 Agent 任务，
必须在指令中显式声明：

“严格遵循 docs/backend-architecture.md 与 docs/codex-rules.md 的规范”。

未声明者，不得执行 Agent 修改。

---

### 职责边界（强制）

- Codex（Agent）仅负责生成和修改代码
- 网页端 Chat 仅负责代码评审、架构分析与风险提示
- 评审阶段不得直接修改代码，任何修改必须回到 Codex 执行

---

### 依赖与版本控制规则（极其重要｜强制）

为避免自动化工具引入不受控依赖、低版本依赖或类型冲突，特制定以下规则：

1. **依赖安装权归属**
   - 所有第三方依赖（dependencies / devDependencies）必须由人类开发者手动决定并安装
   - Codex 不得擅自决定是否引入依赖，也不得决定版本号

2. **package.json 修改禁令**
   - Codex 不得新增、删除或修改 package.json 中的任何依赖项
   - 包括但不限于 dependencies、devDependencies、optionalDependencies

3. **@types/* 包禁令**
   - Codex 禁止引入任何 @types/* 包
   - 如某依赖是否需要类型定义存在不确定性，应由人类开发者判断

4. **缺失依赖的处理方式（唯一允许行为）**
   - 如在实现过程中发现缺少第三方依赖，Codex 只能：
     - 明确指出依赖名称
     - 给出推荐的最新稳定版本号
     - 简要说明该依赖的用途
   - 但不得修改 package.json，不得生成安装命令

5. **默认假设**
   - Codex 应假设：当前工程使用最新 Node.js LTS、最新稳定主版本依赖
   - 不得基于“旧项目兼容性”自行回退版本

---

### 代码生成风格约束（强制）

- Codex 在生成或修改代码时，如涉及装饰器密集型库，包括但不限于：
  - class-validator
  - class-transformer
  - @nestjs/swagger
  - NestJS 框架中大量依赖装饰器的相关模块

- **import 的最终格式以 Prettier 自动格式化结果为准**：
  - 单行或多行 import 均视为合规
  - Codex 不得为满足“多行 import”而刻意绕开 Prettier 行为

- 在以下场景中，**允许并推荐** Codex 使用 `// prettier-ignore` 固定 import 或装饰器相关代码格式：
  - 教学示例代码，需要保持结构稳定
  - 装饰器数量较多、可读性显著受影响
  - 已明确存在 TypeScript / ESLint / IDE 工具链解析异常风险
  
  使用约束说明：
    -  `// prettier-ignore` 不得作为逃避整体格式化规范的常规手段
    - 仅限于局部、明确、可说明理由的代码片段使用

示例（合法）：

```ts
// prettier-ignore
import {
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
```

该约束依据：
- `docs/backend-architecture.md` 第 4.5 节（代码风格补充规范）

违反上述约束的情形，仅限于以下情况：

- Codex 明知可由 Prettier 自动处理，却人为制造不一致格式
- Codex 在明确需要 `// prettier-ignore` 的场景下拒绝使用，导致代码可读性或稳定性显著下降

---

### Schema timestamps 约束（强制｜红线）

当 Codex 生成或修改 Mongoose Schema 时：

- 如 Schema 使用：

  ```ts
  @Schema({ timestamps: true })
  ```

则必须遵循：

- 禁止在 Schema class 中声明以下字段：
  - createdAt
  - updatedAt
  - 以及 timestamps 自定义映射后的等价字段名；
- 以上字段必须完全由 Mongoose timestamps 机制维护。

违规处理：
- 任何包含上述重复声明的 Schema 生成或修改，视为 不符合执行规则的无效修改，应回滚并重新执行。

---

### Mongoose Schema @Prop 类型可推断性约束（强制｜红线）

当 Codex 生成或修改 NestJS Mongoose Schema（@nestjs/mongoose）时：

- 对任何 **union / nullable / ambiguous** TypeScript 类型字段（包括但不限于：
  - `Date | null`
  - `string | null`
  - `Types.ObjectId | null`
  - `A | B`
  - `X & Y`
  ），**必须**在 `@Prop()` 中显式声明 `type`，禁止依赖 reflect-metadata 自动推断。

示例（合法）：

```ts
@Prop({ type: Date, default: null })
removedAt?: Date | null;
```

示例（非法｜会导致 CannotDetermineTypeError）：
```ts
@Prop()
removedAt?: Date | null;
```
违规处理：
- 任何未显式声明 type 且使用 **union/nullable/ambiguous** 类型的 Schema 修改，视为不符合执行规则的无效修改，应回滚并重新执行。

---

### 工具链兼容性写法约束（强制）

- Codex 在生成或修改 Service 层代码时：
  - 遇到 `await` + 链式调用（如 `findById().lean().exec()`），优先使用单行链式调用
  - 对 `map/filter/reduce` 等回调为单表达式的情况，优先使用单行箭头函数
  - 避免在函数调用参数中换行并使用尾逗号（trailing comma），以免触发 ESLint/Parser 边缘报错

该约束依据：
- `docs/backend-architecture.md`（Service 层工具链兼容性写法条款）

违反上述约束且已影响工具链稳定性或类型安全的修改，视为不符合执行规则，应回滚并重新执行。

---

### Mongoose Lean 查询的类型约束（强制）

- Codex 在生成或修改 Service 层代码时：
  - 如使用 Mongoose `.lean()` 查询，并在后续逻辑中访问以下字段之一：
    - `_id`
    - `createdAt`
    - `updatedAt`
  - **必须**遵循 `docs/backend-architecture.md` 第 4.2.z 节
    《Mongoose Lean 查询的类型约束规范（强制）》。

- 具体要求包括但不限于：
  - 为 `.lean()` 查询显式指定返回泛型；或
  - 在局部变量、Map value、函数参数类型中补充 `WithId / WithTimestamps` 类型约束。

- 禁止通过 `as any`、隐式断言或假设字段存在来规避类型约束。

违规处理：
- 违反上述约定的修改，视为不符合执行规则，应回滚并重新执行。

---

### 执行策略约束（防越界）

- Codex 仅实现指令中明确要求的步骤
- 不得提前实现后续 Step 的功能
- 如当前步骤目标为“骨架 / 结构就位”，允许空实现或最小实现
- 不得为了“代码完整性”而提前引入复杂实现

---

### 违规处理原则（默认）

如 Codex 行为违反以上规则中明确标注为“强制”的架构或安全约束：
- 视为无效修改
- 应回滚该修改

仅涉及代码格式、展示形式且不影响语义与工具链稳定性的，不作为回滚依据。
