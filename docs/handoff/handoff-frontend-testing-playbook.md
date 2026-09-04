# EduForge 前端测试与 Browser Evidence 治理手册

## 1. Scope / Owner

本文是 EduForge 前端测试、Browser evidence、Agent-assisted Browser smoke 与 Human smoke 的唯一 Owner。后端 Jest/HTTP E2E、测试数据库、fixture 与 cleanup 由 [Backend testing playbook](./handoff-backend-testing-playbook.md) 维护；当前页面与路由事实见 [Frontend route map](./handoff-frontend-route-map.md)，稳定 UI/UX 判断基线见 [Frontend design baseline](./handoff-frontend-design-baseline.md)。

本文维护证据职责和选择规则，不维护产品 Roadmap、逐轮执行日志、几百行测试文件清单或 deterministic CI 通过记录。

## 2. Current Test Baseline

当前 frontend 已使用现有 `@playwright/test` 作为标准 pure/static contracts runner，并保留 `lint`、`typecheck` 与 `build` 静态门禁。contracts 配置、目录、命令与首个 route-path contract 见第 4 节；该 runner 不启动 Browser。独立 Browser runner 与当前唯一 micro-profile 见第 7.3 节；Playwright dependency 本身不代表 Browser regression，当前可执行资产为：

> 当前 deterministic scripted Browser executable = 1 个 micro-profile：BFF Cookie Roundtrip & BrowserContext Isolation。

该 profile 仅证明 Cookie/Storage 的 Browser-native 合同，不表示产品 UI 已通过或失败，也不构成 UI golden path evidence。Agent-assisted / Human smoke 继续按本文治理，未执行的流程不得写成 passed evidence。

## 3. Risk Classification 与 Test Evidence Classes

先判断风险从哪里可达，再选择最低充分证据层：

| 风险分类 | 判定边界 |
|---|---|
| `ui_reachable` | 正常用户可通过当前正式 UI 产生的状态或风险；UI 可达不自动赋予 scripted Browser 资格 |
| `public_api_reachable` | UI 不一定提供入口，但正式公开 API 可以合法触达 |
| `legitimate_concurrency` | 正常并发、重复请求、竞态或客户端合法重试可能产生 |
| `internal_corruption_only` | 只有手工改 DB、破坏内部数据或绕过正式合同才能制造；不得据此自动扩张 Browser / E2E |
| `manual_or_real_device` | 需要真实设备、人类主观判断或无法稳定自动化的现实交互 |
| `general_gate` | lint、typecheck、build、static contract 等项目级质量门禁 |

风险分类只决定候选的真实来源，不取代下表的证据职责，也不要求每个风险逐层重复证明。

| 证据类别 | 当前资产 / 工具 | 当前证明语义 | 重复与缺口 | 是否扩张 |
|---|---|---|---|---|
| A. Pure / Static Contract | Playwright Test contracts runner 与 route-path spec（见第 4 节）；ESLint、Next typegen、TypeScript、Next build | 路径稳定性、动态段/查询编码，以及静态类型、import、路由/build 可生成性与 lint | 已有独立 contracts 目录；不证明运行时 Session、HTTP 或 UI | 按变更复用现有 runner，不为数量扩张 |
| B. Unit / Logic | 独立 unit/component spec = 0；pure/static contract 归 A 类 | 当前无独立组件或其他局部逻辑证据 | 若未来抽出稳定的 formatter/state helper，可出现低成本缺口；当前空白本身不阻断 | 仅为独立、稳定、低成本逻辑增加，优先复用现有 runner，不机械补齐组件快照 |
| C. HTTP E2E / Integration | 前端无独立 HTTP suite；后端 Jest + Supertest E2E 是公开 API 主 Owner | 认证、DTO、角色/ownership、Submission/AI Feedback 与数据库终态 | 不重复搬到 Browser；BFF Cookie/Context 子事实由第 7.3 节提供专门证据 | API 风险优先补后端 HTTP E2E；仅 Browser-only 部分再升级 |
| D. Scripted Browser | 独立 Playwright Browser runner；1 个 BFF Cookie/Context micro-profile（见第 7.3 节） | Chromium 接受 Cookie、HttpOnly、自动发送及 Context Cookie/Storage 隔离 | 不验证 UI，不替代 HTTP E2E，不证明其他 Browser 合同 | 仅通过准入的独立 Browser-native 候选才扩张 |
| E. Agent-assisted Browser smoke | 本文定义治理；执行时使用 Agent 可控制的真实 Browser | 当前 production UI 的客观可操作性、页面 wiring 与真实用户主流程 | 不是仓库内 CI asset，也没有历史 passed 结果可继承 | 按产品主链和实际变更选择少量场景，不固定全量矩阵 |
| F. Human smoke | 本文 + Frontend design baseline | 清晰度、认知负担、教学表达、视觉/UX 与真实教学判断 | 自动化不能替代；当前无统一签收记录 | 保留人工 Owner，不伪装成自动化 |

## 4. Pure / Static Contract

从 `frontend` 目录执行的当前真实命令：

```powershell
npm run test:contracts:list
npm run test:contracts
npm run lint
npm run typecheck
npm run build
```

- 标准 runner 为 Playwright Test，配置：`frontend/playwright.contracts.config.ts`；pure/static contracts 目录：`frontend/test/contracts`。先用 `test:contracts:list` 确认发现范围，再用 `test:contracts` 执行。
- 首个资产 `frontend/test/contracts/routes-paths.contract.spec.ts` 验证 `frontend/lib/routes/paths.ts` 的关键静态路径、动态段 URL-safe encoding、`tasksFromClassroom()` 的 classroomId 编码与 `status=PUBLISHED`，以及课堂任务 submissions 的双动态段编码。
- contracts 仅使用 `test` / `expect` 与被测纯模块，不使用 Browser fixture，不启动 Browser 或服务，不连接网络/数据库，也不依赖环境变量；Browser evidence 仍须按本文既有最低充分规则另行资格审查。
- lint/typecheck/build 是代码变化后的静态门禁，不证明登录、Cookie、BFF、请求副作用或真实页面流程。
- 纯展示映射、序列化、资格判断等逻辑如果可以脱离 React/Browser 独立证明，应优先复用现有 contracts runner，不因假设未来需求新增依赖或并行 runner。
- 文档-only 变化只做文档、链接、diff 与范围门禁，不机械运行 frontend build。

## 5. Unit / Logic

当前前端除第 4 节的 pure/static contract 外，没有独立 unit/component test 资产。未来只有在逻辑已经稳定抽离、错误风险真实且静态类型不能充分证明时，才增加最低充分测试，并优先复用现有标准 runner；组件结构、文案或 selector 不应默认用脆弱快照重复维护。

## 6. HTTP E2E 与前端相关边界

- 登录、Session 创建/失效、角色/ownership、DTO、任务发布、Submission、Feedback、AI Feedback 请求与数据库终态，优先由 Backend testing playbook 中的 HTTP E2E 证明。
- “业务重要”不构成 Browser 升级理由。公开 API 可证明的合同，不在 Browser 再模拟请求矩阵。
- 前端 API helper/BFF 的静态 wiring 先由源码、typecheck/build 和 [Frontend API map](./handoff-frontend-api-map.md) 核对；只有真实 Browser origin、Cookie、credentials/CORS 或 Browser request behavior 无法由低层证明时，才进入 Browser 候选。

## 7. Scripted Browser Governance

### 7.1 准入

scripted deterministic Browser 只用于不可由 Pure/Unit/HTTP E2E 可靠证明的 Browser-native 语义，例如：

- Session Cookie 在真实 Browser 中的接收、持久化与隔离；
- 独立 BrowserContext 的身份/Cookie 隔离；
- navigation 或 reload 对登录态的 Browser lifecycle 影响；
- credentials、CORS、origin 与真实浏览器请求行为；
- BFF/Set-Cookie 必须经真实 Browser topology 才能证明的合同。

页面重要、流程短、selector 稳定、希望 CI 回归或属于黄金路径，都不单独赋予 scripted 资格。普通 API/DTO/业务分支、页面文案、组件层级、点击顺序和整条用户 workflow 不应 Browser 化。

### 7.2 Micro-profile

合格资产必须保持薄：

1. 一个 profile 聚焦一个 Browser-native 合同，只含 1–4 个紧密相关场景。
2. 使用最小合法前置，不把教师/学生完整业务主链塞入 scripted body。
3. 只断言 Browser 不可替代事实；服务端终态复用既有 HTTP E2E，必要时才增加最小 verifier。
4. 一个 profile 的完整证据闭环原则上保持同一 Git code state、同一最小前置、一次 Browser execution、确有必要时一次对应 verifier，以及一次精确 cleanup。
5. 不同 profile 的前置、执行、证据与 cleanup 相互独立；后续其他 profile 失败，不自动推翻已经完整闭环并通过的 profile。
6. 仅为合格合同增加必要资产；当前 micro-profile 使用 synthetic upstream，不需要 Browser DB、业务 fixture 或 test-only UI hook。

新增候选仍须先报告证据缺口与准入理由，再评估现有标准 Playwright 的配置与执行边界；runner 和依赖的存在不自动赋予资格，不得私建 Browser runner 或无故安装依赖。

scripted Browser 采用以下止损：

- 静态审计已经确认某 profile 的主要断言是 UI semantic 时，不必先让它失败若干轮；直接放弃 scripted 方案，转为 Agent-assisted、Human 或更合适的低层证据。
- 对真正合格的 non-UI scripted profile，测试资产自身只允许一次最低充分修复。
- 同一种 execution mode / asset 方案连续两轮主要因 `spec/test`、`fixture`、`support/runner`、`environment` 或 `tool_limitation` 失败时，禁止第三轮机械 patch / rerun；必须重新选择 evidence layer、execution mode 或 profile 设计。

该止损防止 scripted Browser 退化为 locator 维护、sleep / timeout 堆叠、testid 扩张或 UI 自动化泥潭；明确的 product contract violation 仍按产品问题处理，不能用模式切换掩盖。

### 7.3 Current Micro-profile

- 配置：`frontend/playwright.browser.config.ts`；spec：`frontend/test/browser/bff-cookie-isolation.browser.spec.ts`；合成上游：`frontend/test/browser/support/browser-probe-upstream.mjs`。与 `test/contracts` 物理分离，仅使用已安装的 Chromium。
- 准入理由是普通 HTTP E2E 无法完整证明真实 Browser 是否接受 `Set-Cookie`、Cookie 是否进入 Context store、HttpOnly 是否阻止 `document.cookie` 访问、后续 Browser 请求是否自动发送 Cookie，以及两个 Context 的 Cookie/Storage 是否隔离；不是因为 BFF 业务重要而升级 Browser。Header forwarding 逻辑、API 状态及普通业务分支仍由 HTTP E2E 负责。
- 两个场景分别验证同一 Context 的 Cookie roundtrip，以及独立 Context A/B 的 Cookie、localStorage 与 sessionStorage 隔离。只导航到非 UI BFF route 并使用 Browser primitive，无 UI locator、表单、点击、视觉或业务页面断言。
- Topology：Chromium → real Next.js frontend origin → `/api/proxy/*` BFF → Node 标准库 synthetic upstream `/api/*`。Playwright `webServer` 托管两个服务，使用 health/BFF echo 就绪检查，`reuseExistingServer: false`，退出时回收其创建的进程；不复用来源不明的已有服务。
- 默认 frontend `127.0.0.1:3100`、upstream `127.0.0.1:5100`；分别用 `EDUFORGE_BROWSER_FRONTEND_PORT`、`EDUFORGE_BROWSER_UPSTREAM_PORT` 覆盖。端口必须不同且专用，不允许 3000/5000；冲突时选择其他空闲端口，不终止已有进程。frontend 的 `FRONTEND_BACKEND_ORIGIN` 由 runner 显式设为该 synthetic upstream，运行真实 Next dev/BFF，涉及同一 `.next` 的命令必须串行。
- 本 profile 不启动真实 backend、不连接任何数据库、不写磁盘业务数据。探针使用专用合成 Cookie `eduforge_browser_probe`，不使用真实 session Cookie；不需要 Browser acceptance DB、业务 fixture 或数据库 cleanup。

从 `frontend` 目录独立执行：

```powershell
npm run test:browser:list
npm run test:browser
```

先核对 discovery 仅包含该 micro-profile，再正式运行；contracts 继续使用第 4 节的独立命令。

## 8. Agent-assisted Browser Smoke

目标是证明当前真实产品流程在真实 Browser 中可操作。它使用预先冻结的业务目标，允许 Agent 适应不改变合同的布局或普通文案变化；结果只能记录为 `Agent-assisted Browser smoke`，不能写成 deterministic CI regression。

当前路由支持的候选主链如下；每次只按任务影响和数据前置选择需要的链路：

| 候选链路 | 当前真实路由与目标 |
|---|---|
| 教师建课/班与发布 | `/login` → `/teacher/courses` 或 `/teacher/classrooms` → `/teacher/tasks` → `/teacher/classrooms/[classroomId]/tasks`；证明可创建/选择教学容器、创建或选择已发布模板并发布课堂任务 |
| 教师查看教学状态 | `/teacher/classrooms/[classroomId]/dashboard`，按任务需要进入 submissions、learning-trajectory、review-pack 或 AI metrics；证明当前状态与导航可理解、可操作 |
| 学生完成任务 | `/login` → `/student/dashboard` → `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` → `/student/submissions/[submissionId]`；证明查看已发布任务、提交代码、查看/请求 AI Feedback，并在产品允许时再次提交 |
| 教师查看提交与反馈 | `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions` → `/teacher/submissions/[submissionId]`；证明教师能进入提交详情并查看或补充反馈 |

这些是候选 smoke，不是每个任务都要全部执行，也不表示尚未执行的流程已通过。未来产品方向不得提前写成当前 smoke。

## 9. Human Smoke

Human smoke 保留以下唯一职责：

- 页面信息层级是否清晰，学生完成任务的认知负担是否过高；
- AI Feedback 的教学表达是否合适、是否可能造成误解；
- 教师是否能快速理解看板、Submission、Feedback 与 Review 类界面并形成教学判断；
- 页面是否符合 Frontend design baseline 的一致性、可读性与克制改动原则；
- 真实教学流程是否合理，以及必须由实际教师/学生判断的体验。

自动化或 Agent 可以收集客观现象，不能把主观体验、教学专业判断或真实使用合理性伪装成自动化通过。

## 10. Database / Fixture Coordination

- 后端已建立独立 Browser acceptance DB foundation 与受控 backend launcher，和普通 HTTP E2E 物理隔离；用途与配置见 [Backend testing playbook](./handoff-backend-testing-playbook.md#5-database-purpose)。当前仍无 Browser fixture/verifier 或 Browser UI/DB Profile。
- FT-02 BFF Cookie/Context micro-profile 的数据库用途仍为 `none`，只使用内存 synthetic upstream 和独立 BrowserContext，不启动 backend、不连接 DB，也不需要业务 fixture、verifier 或数据库 cleanup。
- 任何写入型 Agent-assisted/Human smoke 在执行前必须明确环境、实际 database、合成账号/数据 ownership 与 cleanup；不得复用来源不明的服务或账号，也不得与可能清理 `eduforge_test` 的 E2E 并行。
- 后续写入型 Browser acceptance 资产须在现有 DB foundation 上单独建立明确的 fixture、ownership 与 cleanup 合同；namespace 不能替代数据库用途隔离。

## 11. Test Selection Rules

推荐证据选择顺序：

> Pure / Static → Unit / Logic → HTTP E2E → Scripted Browser micro-profile → Agent-assisted Browser smoke → Human smoke

这不是逐层全部执行。先使用第 3 节分类确认风险来源，再用紧凑的 Q1/Q2/Q3 选择主证据：

1. **Q1：不用真实 Browser 能可靠证明吗？**能则使用 Pure/Static、Unit/Logic 或 HTTP E2E 等更低层证据；HTTP 可以证明的合同，不因业务重要升级成 Browser。不能才进入 Browser evidence 判断。
2. **Q2：Browser 要证明 Browser-native semantic 还是 UI semantic？**BrowserContext、Cookie、HttpOnly、Storage、origin、CORS / credentials、browser lifecycle 与浏览器原生网络行为，可以评估 scripted deterministic micro-profile；页面流程、可见内容、按钮交互、locator 与用户任务完成路径属于 UI semantic，默认 Agent-assisted。
3. **Q3：是否需要主观判断、教学合理性、UX 质量、真实设备体验或专业人员判断？**需要则由 Human smoke / Human verification 承担。

同一风险只设一个主证据 Owner，其他层只补不可替代边界；scripted Browser 只证明 Browser-native semantic，客观 production UI 默认 Agent-assisted，Human 保留主观、教学与真实设备职责。

**Happy Path First：**证据实施顺序为：先证明正常主链可用；再补高价值 defensive / non-UI Browser 风险；再补少量代表性 recovery；最后处理工作包收口型证据。Happy Path 尚未稳定时，不持续扩大低频异常状态矩阵。该顺序是通用治理，不在本文提前定义未来业务流程。

**Failure Attribution：**测试失败不自动等于产品失败；先归因，再决定修改 production code、test/spec、fixture、runner/support、environment 或 execution mode。

| 归因 | 语义 |
|---|---|
| `product` | 稳定复现且违反已冻结的正式产品合同 |
| `spec/test` | 测试合同、断言、选择器或测试实现错误、过时或不充分 |
| `fixture` | 测试前置数据、账号、namespace 或生命周期不满足既定测试合同 |
| `support/runner` | 测试支撑、进程编排、等待方式、runner 配置或资源回收问题 |
| `environment` | 端口、构建产物、配置、依赖服务、权限或执行环境不正确 / 不可用 |
| `tool_limitation` | 当前工具或 execution mode 无法可靠产生、观察或证明目标事实 |
| `not_executed` | 目标测试没有形成一次有效执行，不能记为 passed 或 failed product evidence |

## 12. Explicit Non-goals

- 不追求 scripted Browser 数量、Playwright 覆盖率或 UI golden path CI。
- 不把 Browser 当作普通 API、DTO、权限、并发或数据库终态测试的替代品。
- 不批量新增前端 unit/component snapshot，不安装依赖，不建设私有 runner。
- 不把尚未实现的未来产品流程写成当前设计或 smoke 事实。
- 不在本文保存逐轮测试日志、截图清单或 release notes。

## 13. Current Known Gaps

- 前端已有 pure/static contracts runner 与首个 route-path contract；其他 unit/logic 证据仅在出现稳定、独立且现有证据无法证明的逻辑风险时增加。
- 当前 scripted 证据限于第 7.3 节的 BFF Cookie roundtrip、HttpOnly 与 Context Cookie/Storage 隔离；其他 reload、credentials/CORS 或 Browser topology 合同仍须按实际风险独立资格审查，不能从该 profile 泛化为已覆盖。
- Agent-assisted 与 Human smoke 目前只有治理和候选范围，没有可继承的 passed evidence、专用 fixture 或结果登记；实际任务必须按真实执行模式报告。
- Browser DB foundation 已存在，但写入型 Browser smoke 的 fixture、verifier 与 UI/DB Profile 尚未建立；不得将数据库连通视为 UI 验收通过。
