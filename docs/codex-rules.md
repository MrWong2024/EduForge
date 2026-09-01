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

## 验收执行责任（强制）

- Codex 不仅负责按指令修改文件，也负责执行指令规定的验收。当前工具、权限和任务边界允许自动完成的步骤必须实际运行，包括指令要求的 lint、typecheck、build、unit、E2E、fixture 生命周期操作、应用启动与健康检查、可可靠完成的 Browser 自动化，以及 Git diff、status 和范围检查。
- Codex 不得只输出命令、步骤或建议让开发者自行运行，也不得把整个验收阶段作为人工操作清单交还开发者。
- 开发者批准权限提示、确认高风险命令或提供外部授权，只是 Codex 执行对应步骤的前置条件，不改变命令执行主体；获得批准后，Codex 必须继续执行。
- 权限审查超时、命令未启动或执行许可未获得时，该步骤必须准确记为 `not_executed`。Codex 应请求必要授权，并在获得授权后重新执行，不得要求开发者复制命令到终端。
- “已请求执行”“已获授权”或“已提供命令”均不构成验收通过；命令已经启动但退出码非 0 时属于实际执行失败。`not_executed`、人工待签收和工具限制均不得记为通过。
- 只有当前工具无法支持的实体设备操作、无法可靠产生或观察的原生交互、必须由人工完成且当前工具无法可靠替代的主观感知或专业判断、Codex 无法代替的外部登录 / 验证码 / 硬件 / 安全审批动作，或取得授权后仍因环境缺少必要工具或权限而无法自动执行的具体单项，才允许请求开发者操作或授权。
- 每个人工例外必须逐项说明 Codex 无法执行的原因、开发者需要完成的具体动作、需要返回的脱敏结果及该项的准确状态。人工协助不得扩张到其他可自动化步骤；人工结果返回后，Codex 仍负责继续完成后续自动化验证和整体收口。
- 开发者默认不负责手工复制 Codex 已能运行的命令，不负责手工执行 Codex 已能完成的 lint、typecheck、build、unit、E2E、fixture 或 Git 检查，也不因权限弹窗存在而接管整个命令执行。

---

## 仓库边界与 Git 操作规则（强制）

- Codex 仅允许访问和修改当前 Git 仓库根目录内的文件。
- 不得通过相对路径、绝对路径、脚本或命令访问、读取或修改相邻项目及仓库外目录。
- 不得假设相邻目录中的项目、代码或文档可作为当前项目事实依据。
- 如发现当前工作目录或 Git 根目录与任务预期不一致，应停止修改并报告。
- 本地生成的操作指南、演示指南及同类非正式生成物必须统一写入 `.local/deliverables/`；不得在仓库根目录创建 `deliverables/`，且这些内容不作为 Git 跟踪资产。
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

## 命令范围与搜索噪声控制（强制）

- Codex 执行只读搜索、复查和验收命令时，也必须控制范围和输出噪声。只读命令虽然不会修改文件，但过宽搜索会浪费上下文、拖慢执行并干扰判断。
- 优先使用任务明确指定的文件列表、目录或 `git diff --name-only` 结果作为命令范围。
- 检查修改范围时，优先使用：
  - `git diff --name-only`
  - `git diff --check -- <明确文件或目录>`
  - `git status --short`
- 不得为了证明“没有误改”而对仓库根目录执行宽关键词搜索。
- 除非任务明确要求全局影响面分析，否则不得从仓库根目录搜索过宽关键词，例如 `package.json`、`.env`、`backend`、`frontend`、`node_modules`、`.next`。
- 默认不得搜索生成目录、依赖目录、缓存目录和构建产物目录，包括但不限于：
  - `node_modules/`
  - `.next/`
  - `dist/`
  - `build/`
  - `coverage/`
  - `.turbo/`
  - `.cache/`
  - `out/`
  - `backend/dist/`
  - `frontend/.next/`
- 除非任务明确要求且已说明理由，不得使用会放开忽略规则或显著扩大搜索范围的参数，例如：
  - `rg --no-ignore`
  - `rg --hidden`
  - `rg -uuu`
  - `rg -g "*"`
- 如确需全局搜索，必须尽量使用明确目录、文件类型或排除规则：
  - 推荐写法：`rg -n "pattern" backend/src frontend/src docs`
  - 推荐写法：`rg -n "pattern" -g "*.ts" -g "*.tsx" backend/src frontend/src`
  - 需要排除目录时的写法：`rg -n "pattern" --glob "!**/node_modules/**" --glob "!frontend/.next/**"`
- 搜索关键词应尽量使用业务字段、函数名、接口路径、DTO 名、环境变量名等精准词，不得用过宽泛词替代精准定位。
- 如搜索结果明显异常膨胀，应停止输出，收窄路径或关键词后重试。
- Codex 输出执行结果时，不得粘贴大段无关搜索结果；应摘要说明命中的文件、行号和结论。

---

## 数据库用途判定与环境隔离（强制）

数据库用途类别只允许使用以下抽象值：

- `none`：纯文档、lint、typecheck、build、静态审计等不需要数据库的任务。
- `development`：日常开发、人工调试和本地业务验证。
- `standard_test`：unit、普通 E2E，以及允许重建或破坏测试数据的自动化测试。
- `browser_acceptance`：Browser fixture、Browser / Chrome 验收、长期保留 namespace 和 post-browser verify。
- `production_or_operations`：生产、迁移、运维或真实数据操作；仅在用户对目标环境和允许操作明确授权后允许。

强制规则：

1. 任何涉及数据库的任务，必须在连接前确定唯一的数据库用途类别。
2. 具体数据库名必须从项目级 testing playbook、项目环境约定、用户明确输入或其他明确项目文档中解析；通用规则不得硬编码任何项目数据库名。
3. `standard_test` 与 `browser_acceptance` 不得共用会被破坏性重置的数据库；namespace 级隔离不能替代数据库级隔离。
4. 同一任务包含多种数据库用途时，必须为每种用途启动独立进程并分别注入进程级环境变量；禁止复用已经设置数据库连接的 shell 上下文，也不得用一份全局环境配置同时服务不同用途。
5. 建立实际连接后，必须读取真实数据库名并与任务声明的允许数据库逐字校验。
6. 实际数据库与任务声明不一致时，必须立即停止；禁止自动回退、猜测或改连其他数据库。
7. 无法唯一解析数据库用途类别或具体数据库时，必须停止并询问用户，不得自行选择。
8. `none` 类任务必须保持不连接数据库，且不得无故启动应用、fixture、测试后端或其他会建立数据库连接的进程。
9. `production_or_operations` 必须同时取得用户对目标环境和允许操作的明确授权；缺少任一项都必须停止。
10. 数据库账号密码、完整数据库连接串、production / operations 凭据、真实人员账号密码、真实应用用户或业务主体认证凭据、可访问真实业务数据或非隔离环境的凭据、OSS AccessKey / Secret、ASR / LLM / SMS 等第三方 Secret，以及未经用户明确授权的其他 Secret，均属于严格保护对象。它们不得出现在 Codex 指令正文、Git 跟踪文件、日志、manifest、截图、生成物、最终报告或提交记录中；本规则不因数据库用途为 `standard_test` 或 `browser_acceptance` 而放宽数据库账号密码和完整连接串。
11. unit / E2E 创建的 synthetic application user、Browser fixture 创建的 synthetic application user，以及本地人工冒烟专用 synthetic application user，只要明确为测试或人工冒烟专用、不对应真实人员、不复用真实密码、不具备生产或真实业务数据访问能力，且创建脚本或 fixture 具有正确的环境和数据库 fail-closed 门禁，其应用账号密码属于普通测试常量。该有限规则只适用于被测应用的纯合成账号密码，不适用于第 10 条的任何严格 Secret。
12. 符合上一条条件的 synthetic application account password 可以使用固定简单值（例如 `12345678`），可以直接写入 tracked test、fixture 或人工冒烟准备脚本，也可以在 Codex 指令、测试文档和测试结果中按需要声明。此类密码不强制来自 Git ignored 文件、环境变量、剪贴板、随机生成、Secret Manager 或父进程注入，也不要求为每个 Profile 单独生成。
13. 同一 synthetic application account 在其 fixture namespace 或人工冒烟生命周期中仍应使用一个确定性固定值，避免无意义的密码生命周期复杂度。固定值可以由 tracked 测试常量或既有稳定配置提供；不得从数据库 URI、数据库用户密码、时间、进程值或其他 Secret 派生，也不得在不同创建、认证或校验阶段无故切换值。
14. 如已准备的 namespace 因 synthetic application account password 不一致而无法通过账号密码校验，不得反复执行 verify、手工补插或修改数据库账号、降低账号有效性或密码校验标准，也不得把 verify 未执行、未通过或密码校验失败记为 prepared gate 通过。必须在继续遵守显式确认、namespace ownership 和数据库隔离规则的前提下，使用正确的固定应用测试密码执行受控 replace，再在相同固定值下执行只读 prepared verify；只有该门禁通过后才能进入 Browser。
15. 数据库账号密码、完整连接串和第 10 条列出的其他严格 Secret 即使来自本地忽略文件，也不得复制到 Git 跟踪文件、文档、日志、manifest、截图、生成物、最终报告或提交记录。第 11 条的 synthetic application account password 不受这项复制禁令约束；具体 Codex 指令仍可填写允许和禁止的数据库名，但不得回显数据库密码或完整连接串。
16. synthetic application account password 不要求仅为了保密而在每一步或命令结束后立即清空。`standard_test` 与 `browser_acceptance` 的配置不得叠加加载到同一进程；同一 shell 将切换数据库用途或被复用时，必须优先启动独立进程，或在切换前清除或覆盖数据库主连接变量、管理连接变量、项目定义的数据库用途变量及其他用途相关变量。具体变量名必须从项目级 testing playbook、项目环境约定、任务声明或用户明确输入中解析；通用规则不得硬编码项目专属变量名。该清理是防止串库的数据库隔离要求，不是密码保密仪式，也不得依赖旧变量或后加载覆盖行为选择数据库。
17. 上述有限例外不削弱第 10 条的严格保护范围；synthetic application account password 与数据库账号密码、数据库 URI、真实人员账号密码及第三方 Secret 必须始终明确区分。

---

## 工具与依赖前置守卫（强制）

- Codex 必须优先复用仓库现有工具和能力；已有工具能够完成任务时，不得另行自研同类 runner、协议客户端、测试框架或其他重复基础设施。
- 指令未明确授权时，不得执行 install、update、download 或任何依赖升级操作。
- 所需成熟工具缺失且指令未授权安装时，必须停止对应部分并报告，将其记为 `not_executed` 或前置阻断；不得擅自实现重复替代基础设施，也不得伪报完成。
- 指令明确要求最小适配现有工具时，只能完成满足当前合同所必需的适配，不得扩大为通用重构或另建平行工具链。
- 工具是否缺失、现有能力是否足够以及建议工具的适配性，必须依据仓库真实 package、锁文件、配置和代码判断，不得凭经验假设已安装或机械建议新增工具。

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
- 不得为解决局部 lean 类型问题擅自引入 `WithTimestamps<T>`、`WithId<T>` 等项目级通用类型；需要 `_id` 或 timestamps 字段时，应按实际查询结果在局部类型中显式声明字段。

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

## 执行策略约束（防越界与最低充分复杂度优先）

- 仅实现指令明确要求的内容。
- 不得提前实现后续阶段。
- 如当前任务目标为骨架、结构就位或最小闭环，允许最小实现。
- 不得为了所谓完整性擅自扩大范围。
- 如实现过程中发现任务前提不足、接口不明确或缺少必要依赖，应停止对应部分并报告，不得自行创造业务规则。
- 不得顺手重构与任务无直接关系的代码。
- Codex 选择方案时必须遵循 `docs/codex-instruction-spec.md` 3.7 的“最低充分复杂度优先”：在满足业务目标，并保证数据完整性、权限、安全、隐私、正常主流程、不可逆业务事实、必要防重复和关键失败恢复的前提下，多个方案均能满足要求时，优先采用实现、测试和维护复杂度最低的方案。
- 对尚未正式投产的当前工作包，若用户已明确旧业务状态或旧开发数据作废，默认以当前基线为唯一真值，不为该作废状态新增或保留运行时迁移、兼容分支、fallback、双路径或专属测试矩阵；该规则不触发全项目 legacy 清理，也不适用于真实已部署数据、正式向后兼容合同、依法或审计需保留的数据，或用户明确要求兼容的情形。
- 多个实现均满足正式合同时，优先选择状态更少、组件更少、服务更少、跨模块依赖更少、异步协调更少，并且更容易人工理解、诊断和恢复的方案。
- 在不降低正式合同和安全底线时，允许多一步操作、多一次刷新、多一次确认、多一次读取或 HTTP 请求、适度串行及合理性能损失；不得仅为少一次点击、更无缝、理论最优性能或极低概率异常自动处理而增加明显不成比例的协调机制。
- 用户明确选择满足合同的简单方案时，Codex 不得自行升级为所谓“更无缝”“更智能”“更高性能”或“更完备”但明显更复杂的实现。
- 不默认增加用户未要求的自动 retry、自动 merge、自动 replay、queue、lease、distributed lock、多套 revision、mutation coordinator 或多人实时协同编辑。同一业务聚合内写操作串行优先不等于系统全局串行；独立业务聚合或互不相关的业务实例仍可正常并行，读操作可以正常并发。

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

## 后端 TypeScript 全量类型检查门禁（强制）

### 触发范围

凡任务修改以下任一内容，必须在 `backend` 目录执行 `npm run typecheck`：

- `backend/src/**/*.ts`
- `backend/test/**/*.ts`
- `backend/scripts/**/*.ts`
- `backend/**/*.spec.ts`
- `backend/**/*.e2e-spec.ts`
- `backend/test/support/**/*.ts`
- `backend/tsconfig*.json`
- `backend/package.json` 中会影响 TypeScript、测试或构建的 script

以下情况均不得免除全量类型检查：

- 即使只修改一个 spec，也必须执行。
- 即使只修改一个 E2E，也必须执行。
- 即使 Jest 实际运行通过，也必须执行。
- 即使 build 通过，也必须执行。
- 即使修改主要是类型、fixture、mock 或 helper，也必须执行。

### 命令口径

- 固定命令：`npm run typecheck`。
- 执行目录：`backend`。
- 不得用临时 `npx tsc` 命令替代正式 package script 作为最终验收。
- 不得只检查某个文件或目录后宣称全量类型检查通过。
- 不得改用 `tsconfig.build.json` 替代 `tsconfig.typecheck.json`。
- 不得在命令尾部过滤错误输出。
- 不得使用 `|| true`、PowerShell 等价吞错写法、修改脚本吞掉退出码或忽略退出码。

### 不可替代性

- build 只验证其编译范围，不能替代全量 typecheck。
- Jest 运行测试不代表所有测试源码已完成全量 TypeScript 检查。
- lint、unit 和 E2E 均不能替代 typecheck。
- typecheck 是独立门禁，必须在结果中单独报告。

### 完成标准

`npm run typecheck` 必须同时满足以下条件才算通过：

- 命令退出码为 0。
- TypeScript errors 为 0。
- 没有通过 exclude 排除失败文件。
- 没有降低 TypeScript 严格度。
- 没有新增 suppression。
- 没有生成应进入 Git 的编译产物或缓存文件。

### 失败处理

如果 `npm run typecheck` 失败，必须报告：

- 错误总数。
- 涉及文件。
- 错误码。
- 哪些错误属于本次修改。
- 哪些错误属于任务前既有问题。

本次修改引入的错误必须修复。任务范围外既有问题不得被静默修改。如果任务目标要求全量后端门禁，`npm run typecheck` 未通过时不得宣称后端任务完成。

不得为了制造 typecheck 通过而：

- 修改 exclude 排除失败文件。
- 关闭 `strictNullChecks` 或降低其他 TypeScript 严格度。
- 新增 `any` 消音。
- 添加双重断言。
- 添加批量非空断言。
- 添加 `@ts-ignore` 或 `@ts-expect-error`。
- 删除或跳过测试。
- 修改脚本吞掉退出码。

### 后端验证范围与最终门禁

后端验证直接复用 `docs/handoff/handoff-backend-testing-playbook.md` 的既有分层规则，并遵循 `docs/codex-instruction-spec.md` 的最低充分证据原则；不建立另一套测试分类或门禁体系。

- 命中上方“后端 TypeScript 全量类型检查门禁”触发范围时，`npm run typecheck` 仍是不可替代的独立强制静态门禁，必须按其完整命令、完成标准和失败处理执行。本节不削弱 TypeScript 类型安全。
- lint、typecheck、build、unit 与 HTTP E2E 按各自真实职责和修改影响选择。默认从定向 unit、定向 HTTP E2E 与必要静态门禁中选择能覆盖实际变化的最低充分集合；在最终代码态实际通过的定向 unit / HTTP E2E 可以作为最终有效动态证据，不要求为了“保险”再机械执行完整 unit 或完整 E2E。
- 只有存在明确影响依据时才扩大验证范围，例如公共 Guard / Pipe / auth、Schema 或共享持久化合同、共享测试或运行基础设施、跨模块公共合同、修改影响无法由定向测试可靠界定、当前任务或工作包最终收口明确要求，或用户明确要求。
- 要求完整 unit 或完整 E2E 时，必须写明具体影响依据和需要覆盖的风险；不得仅以“为了保险”“为了完整”或“后端代码有修改所以全跑”作为理由。
- 证据层不得互相冒充：局部 unit 不能替代真正需要的真实 HTTP、Guard、全局 Pipe、数据库终态或跨模块闭环；HTTP E2E 也不替代静态类型检查。缩小测试范围不得削弱权限、数据完整性、Schema、不可逆业务事实或真实 HTTP 合同。
- 最终报告分别说明实际选择的 lint、typecheck、build、unit、HTTP E2E 及其他适用证据、选择依据和执行结果；未被真实影响要求的完整套件无需机械列为未通过或阻断项。

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
