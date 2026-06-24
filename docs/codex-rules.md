# Codex 执行规则

> 适用于采用 `frontend\`、`backend\`、`docs\` 目录结构的 TypeScript 全栈项目。
> 后端主要采用 NestJS、Mongoose；前端主要采用 Next.js。
> 本文档负责约束 Codex 的实际执行行为；Codex 指令的生成结构由 `docs/codex-instruction-spec.md` 负责。

---

## Agent 执行规则（强制）

- 修改 `backend\` 时，必须遵循：
  - `docs/backend-architecture.md`
  - `docs/codex-rules.md`
- 修改 `frontend\` 时，必须遵循：
  - `docs/frontend-architecture.md`
  - `docs/codex-rules.md`
- 同时修改 `backend\` 和 `frontend\` 时，必须分别遵循对应架构文档。
- 仅修改 `docs\` 时：
  - 必须遵循任务明确指定的文档范围；
  - 不要求机械引用前后端架构文档；
  - 不得顺带修改代码。
- Codex 必须严格执行按 `docs/codex-instruction-spec.md` 生成的任务边界、非目标、文档同步要求和验收要求。

---

## 职责边界（强制）

- Codex 负责在当前 Git 仓库内，按照明确指令读取、创建或修改代码、文档和配置。
- Chat 或其他评审方负责需求分析、架构判断、指令生成、代码审查和风险提示。
- 审查阶段发现问题后，应形成新的明确指令，再交由 Codex 修改。
- Codex 不得在没有明确任务边界的情况下自行扩展实现范围。

---

## 仓库边界与 Git 操作规则（强制）

- Codex 仅允许访问和修改当前 Git 仓库根目录内的文件。
- 不得通过相对路径、绝对路径、脚本或命令访问、读取或修改相邻项目及仓库外目录。
- 不得假设相邻目录中的项目、代码或文档可作为当前项目事实依据。
- 如发现当前工作目录或 Git 根目录与任务预期不一致，应停止修改并报告。
- 除非任务明确要求，否则 Codex 不得执行以下 Git 操作：
  - `git commit`
  - `git push`
  - `git pull`
  - `git merge`
  - `git rebase`
  - `git reset`
  - `git clean`
  - 创建、切换或删除分支
- 不得执行可能丢失现有修改的破坏性命令。

---

## 依赖与版本控制规则（极其重要｜强制）

1. **依赖安装权归属**
   - 所有第三方依赖必须由人类开发者决定并安装。
   - Codex 不得擅自决定是否引入依赖，也不得决定版本号。

2. **依赖清单修改禁令**
   - Codex 不得擅自新增、删除或升级依赖。
   - Codex 不得擅自修改 `package.json` 中的 `dependencies`、`devDependencies`、`optionalDependencies`。

3. **`@types/*` 包禁令**
   - Codex 不得擅自引入任何 `@types/*` 包。
   - 如某依赖是否需要额外类型定义存在不确定性，应由人类开发者判断。

4. **缺失依赖的处理方式**
   - 如实现过程中发现缺少第三方依赖，Codex 只能：
     - 明确指出依赖名称；
     - 说明依赖用途；
     - 给出建议版本。
   - 不得修改依赖清单，不得生成安装行为。

5. **版本事实依据**
   - 已初始化项目必须以当前 `package.json`、锁文件、配置文件和仓库实际代码为事实依据。
   - 未初始化项目的 Node.js 版本、依赖版本和初始化方案由人类开发者明确决定。
   - Codex 不得仅凭经验自行升级、降级或替换依赖版本。

6. **锁文件约束**
   - 除非任务明确允许，Codex 不得主动修改 `package-lock.json`、`pnpm-lock.yaml`、`yarn.lock` 等依赖锁文件。
   - 不得为了消除无关差异重新生成锁文件。

---

## 代码生成风格约束（强制）

- 代码的最终格式以项目现有 Prettier 结果为准。
- Codex 不得为了个人格式偏好绕过 Prettier。
- `// prettier-ignore` 只能局部、谨慎、有明确理由地使用，不得作为逃避整体格式化规范的常规手段。
- 以下场景允许使用 `// prettier-ignore`：
  - 装饰器密集代码因自动格式化显著降低可读性；
  - 需要保持稳定结构的局部示例代码；
  - 已确认存在 TypeScript、ESLint、Parser 或 IDE 工具链兼容问题。
- 使用 `// prettier-ignore` 时，应确保理由清晰且作用范围最小化。

---

## Schema timestamps 约束（强制｜红线）

当 Codex 生成或修改 Mongoose Schema 时：

- 如 Schema 使用：

  ```ts
  @Schema({ timestamps: true })
  ```

- 则禁止在 Schema class 中声明以下字段：
  - `createdAt`
  - `updatedAt`
  - 以及 `timestamps` 自定义映射后的等价字段名
- 以上字段必须完全由 Mongoose `timestamps` 机制维护。

违规处理：

- 任何包含上述重复声明的 Schema 修改，视为无效修改，应回滚并重新执行。

---

## Mongoose Schema `@Prop` 类型可推断性约束（强制｜红线）

当 Codex 生成或修改 NestJS Mongoose Schema（`@nestjs/mongoose`）时：

- 对任何 `union`、`nullable`、`ambiguous` TypeScript 类型字段，必须在 `@Prop()` 中显式声明 `type`，禁止依赖 `reflect-metadata` 自动推断。
- 典型情形包括但不限于：
  - `Date | null`
  - `string | null`
  - `Types.ObjectId | null`
  - `A | B`
  - `X & Y`

示例（合法）：

```ts
@Prop({ type: Date, default: null })
archivedAt?: Date | null;
```

示例（非法）：

```ts
@Prop()
archivedAt?: Date | null;
```

违规处理：

- 任何未显式声明 `type` 且使用上述类型的 Schema 修改，视为无效修改，应回滚并重新执行。

---

## Mongoose Schema 枚举字段显式 primitive type 约束（强制｜红线）

当 Codex 生成或修改 NestJS Mongoose Schema（`@nestjs/mongoose`）时：

- 对任何字符串枚举、数字枚举、字面量联合或具有明确枚举语义的字段，只要 `@Prop()` 中使用了 `enum`，或字段 TypeScript 类型不是简单稳定可反射的基础原始类型，就必须在 `@Prop()` 中显式声明 primitive `type`（如 `String`、`Number`）。
- 禁止依赖 `reflect-metadata` 自动推断这类字段的类型。

示例（合法）：

```ts
@Prop({ type: String, enum: StatusEnum, default: StatusEnum.Active })
status!: StatusEnum;
```

示例（非法）：

```ts
@Prop({ enum: StatusEnum, default: StatusEnum.Active })
status!: StatusEnum;
```

说明：

- 本规则用于降低 `CannotDetermineTypeError` 与 Schema metadata 推断失败风险。
- 本规则与上一条规则互补：
  - 上一条覆盖联合、可空、歧义类型；
  - 本条额外覆盖枚举语义字段，即使字段不是联合或可空类型，也必须显式声明 primitive `type`。

违规处理：

- 任何命中上述枚举语义风险模式但未显式声明 primitive `type` 的 Schema 修改，视为无效修改，应回滚并重新执行。

---

## 工具链兼容性写法约束（强制）

- 默认以项目现有 Prettier、ESLint 和 TypeScript 配置为准。
- 仅在已确认现有工具链对特定换行、链式调用写法或尾逗号存在兼容问题时，才优先采用兼容性写法。
- 不得把单行链式调用、单行箭头函数或去除尾逗号机械应用为所有项目的绝对格式要求。
- 涉及后端 Service 层或类似逻辑代码时，可在已确认兼容性问题的前提下优先采用更稳定的局部写法。
- 如需判断工具链兼容约束，应引用对应架构文档中的相关规范，不得依赖具体章节编号。

---

## Mongoose Lean 查询的类型约束（强制）

Codex 在生成或修改后端查询逻辑时，如使用 Mongoose `.lean()` 查询，并将结果传入 mapper、serializer、DTO builder、response builder，或在后续逻辑中访问 `_id`、`createdAt`、`updatedAt`、populate 字段、select / 投影字段、聚合字段，必须显式建模查询结果类型。

具体要求：

- 不得使用 `as any`、隐式断言或双重断言绕过类型约束。
- 不得把 `.lean()` 查询结果直接当作完整 Mongoose document 使用。
- 不得把 `select`、投影或聚合结果声明为完整 Schema 实体类型。
- mapper、serializer、DTO builder、response builder 的入参类型必须表达其实际读取字段。
- 如果读取 `_id`，类型中必须显式包含 `_id` 字段。
- 如果读取 `createdAt`、`updatedAt`，类型中必须显式包含对应字段。
- 对 `findOne().lean()` 结果必须处理 `null`。
- 对 `find().lean()` 结果必须明确数组元素类型。
- 对 populate 结果必须明确被填充字段结构，不得假设其仍是原始 id 或完整 document。
- 对 aggregate 或投影阶段后的结果，不得套用原 Schema 类型，应定义聚合或投影结果类型。
- 不得为了绕过 lean 类型问题而去掉 `.lean()`，除非当前任务明确要求改变查询策略，并说明性能与行为影响。
- 不得为了消除 TypeScript 报错而删除字段访问、删除返回字段或改变业务语义。

类型组织方式：

- 局部只用一次的类型，优先在当前 service 文件就近定义。
- 多处复用且语义稳定的类型，才考虑提取到模块级 `interfaces`、`types` 或等价位置。
- 可以使用仓库已有的类型；但如果仓库尚未形成某个全局工具类型范式，Codex 不得为解决局部问题擅自创建全局类型。
- ReviewX 不引入 `WithTimestamps<T>` 作为项目级通用类型，也不把 `WithId<T>` 作为项目级推荐范式；需要 `_id` 或 timestamps 字段时，按实际查询结果在局部类型中显式声明字段。

示例：

```ts
import { Types } from 'mongoose';

type ProjectSummaryLean = {
  _id: Types.ObjectId;
  projectNo: string;
  name: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function toProjectSummaryResponse(project: ProjectSummaryLean) {
  return {
    id: project._id.toString(),
    projectNo: project.projectNo,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

const projects = await this.projectModel
  .find(filter)
  .select({ projectNo: 1, name: 1, status: 1, createdAt: 1, updatedAt: 1 })
  .lean<ProjectSummaryLean[]>()
  .exec();

return projects.map(toProjectSummaryResponse);
```

违规处理：

- 违反上述约定的修改，视为无效修改，应回滚并重新执行。

---

## 执行策略约束（防越界）

- 仅实现指令明确要求的内容。
- 不得提前实现后续阶段。
- 如当前任务目标为骨架、结构就位或最小闭环，允许最小实现。
- 不得为了所谓完整性擅自扩大范围。
- 如实现过程中发现任务前提不足、接口不明确或缺少必要依赖，应停止对应部分并报告，不得自行创造业务规则。
- 不得顺手重构与任务无直接关系的代码。

---

## 验证规则（强制）

- 仅执行当前 `package.json` 中真实存在的脚本，不得凭空假设存在 `lint:file`、`test:e2e` 等命令。
- 对代码修改，优先执行与本次修改范围匹配的 `build`、`lint` 和测试。
- 修改少量文件时，优先使用已有的定向检查能力。
- 不默认执行带自动修复或大范围写入效果的命令。
- 不得为了修复全量检查中的既有范围外错误，修改非本次任务文件。
- 如全量检查失败，必须区分：
  - 本次修改导致的问题；
  - 仓库原有或任务范围外的问题。
- `backend\` 和 `frontend\` 应分别在各自目录执行对应验证命令。
- 纯文档任务通常只需执行差异检查、关键词检查和仓库状态检查，不应机械执行前后端构建。

---

## 后端测试分层策略（强制）

后端任务应按变更风险选择测试层级，不要求所有规则变化都新增 E2E，也不得把 `service.spec.ts` 视为真实 HTTP 链路的替代品。

1. **`service.spec.ts`：覆盖规则与边界**
   - 适用于业务规则、状态机、聚合统计、优先级、边界条件、错误分支和副作用。
   - 规则类变更优先补 `service spec`，不必为了纯计算规则强行搭建完整 HTTP 或数据库链路。

2. **`controller.spec.ts` / DTO validation：覆盖参数与校验层**
   - 适用于请求参数、DTO 字段、`ValidationPipe`、默认值、参数转换以及 controller 到 service 的参数传递。
   - 新增 query 参数或 DTO 字段时，不能只写 `service spec`；至少应补 `controller spec`、DTO validation 测试或确认已有等价覆盖。

3. **`backend/test/*.e2e-spec.ts`：覆盖真实 HTTP 与关键闭环**
   - 适用于真实 HTTP、权限、Guard、认证状态、全局 Pipe、数据库读写、模块装配和跨模块关键闭环。
   - 通用闭环示例应表述为“认证请求 -> 数据写入 -> 派生结果读取”这类真实链路验证，而不是具体领域流程。
   - E2E 用于验证真实链路，不应用来承载所有边界条件；大量规则边界应下沉到 `service spec` 或 controller/DTO 测试。

4. **选择规则**
   - 规则类任务：优先 `*.service.spec.ts`。
   - 参数、DTO、`ValidationPipe` 类任务：优先 `*.controller.spec.ts`、DTO validation 测试或等价覆盖。
   - 权限、路由、Guard、真实 HTTP 行为：考虑 `*.e2e-spec.ts`。
   - 涉及 controller、query、DTO、`ValidationPipe`、Guard、权限、接口路径的任务，不能只补 `service spec`。

---

## 文档同步执行规则（强制）

- Codex 必须按照当前任务中“〖文档同步要求〗”列出的范围同步文档。
- 不得自行创建任务未要求的新文档。
- 不得为了形式完整修改与本次任务无关的文档。
- 如任务要求同步的文档不存在，或发现指令遗漏了明显必要的文档同步，应报告情况，不得擅自扩大范围。
- 纯文档通用化任务无需机械创建 `handoff` 文档。

---

## 违规处理原则（默认）

- 如 Codex 行为违反以上明确标注为“强制”的约束，视为无效修改，应回滚并重新执行。
- 仅涉及展示形式且不影响语义、工具链稳定性或类型安全的问题，不作为回滚依据。
