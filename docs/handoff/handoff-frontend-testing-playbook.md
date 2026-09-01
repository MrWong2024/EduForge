# EduForge 前端测试与 Browser Evidence 治理手册

## 1. Scope / Owner

本文是 EduForge 前端测试、Browser evidence、Agent-assisted Browser smoke 与 Human smoke 的唯一 Owner。后端 Jest/HTTP E2E、测试数据库、fixture 与 cleanup 由 [Backend testing playbook](./handoff-backend-testing-playbook.md) 维护；当前页面与路由事实见 [Frontend route map](./handoff-frontend-route-map.md)，稳定 UI/UX 判断基线见 [Frontend design baseline](./handoff-frontend-design-baseline.md)。

本文维护证据职责和选择规则，不维护产品 Roadmap、逐轮执行日志、几百行测试文件清单或 deterministic CI 通过记录。

## 2. Current Test Baseline

当前 `frontend/package.json` 只有 `lint`、`typecheck` 与 `build` 等静态门禁，没有 test script。仓库中没有前端 Jest/Vitest/Cypress/Playwright config、spec 目录或顶层 Browser runner 依赖；因此：

> 当前 deterministic scripted Browser asset = 0。

这表示当前没有可执行的 scripted Browser regression，不表示产品 UI 已通过或失败。此前也没有 Agent-assisted / Human smoke 的独立 Owner；本文建立治理边界，但不把未执行的流程写成 passed evidence。

## 3. Test Evidence Classes

| 证据类别 | 当前资产 / 工具 | 当前证明语义 | 重复与缺口 | 是否扩张 |
|---|---|---|---|---|
| A. Pure / Static Contract | `npm run lint`、`npm run typecheck`、`npm run build`；ESLint、Next typegen、TypeScript、Next build | 静态类型、import、路由/build 可生成性与 lint | 没有独立 `contracts` test 目录；不证明运行时 Session、HTTP 或 UI | 按变更执行；不为数量新增 contract runner |
| B. Unit / Logic | 当前前端 spec = 0，未安装前端 test runner | 当前无动态局部逻辑证据 | 若未来抽出稳定的 formatter/state helper，可出现低成本缺口；当前空白本身不阻断 | 仅为独立、稳定、低成本逻辑增加，不机械补齐组件快照 |
| C. HTTP E2E / Integration | 前端无独立 HTTP suite；后端 Jest + Supertest E2E 是公开 API 主 Owner | 认证、DTO、角色/ownership、Submission/AI Feedback 与数据库终态 | 不重复搬到 Browser；BFF/真实 origin 的 Browser-native 子事实当前无专门证据 | API 风险优先补后端 HTTP E2E；仅 Browser-only 部分再升级 |
| D. Scripted Browser | 当前资产 0；无 Playwright/Cypress script、config、spec 或顶层依赖 | 当前没有 deterministic Browser 证明 | 没有已确认必须长期回归的 Browser-native 缺口 | 保持 0 合理；具体候选通过准入后才建立薄 micro-profile |
| E. Agent-assisted Browser smoke | 本文定义治理；执行时使用 Agent 可控制的真实 Browser | 当前 production UI 的客观可操作性、页面 wiring 与真实用户主流程 | 不是仓库内 CI asset，也没有历史 passed 结果可继承 | 按产品主链和实际变更选择少量场景，不固定全量矩阵 |
| F. Human smoke | 本文 + Frontend design baseline | 清晰度、认知负担、教学表达、视觉/UX 与真实教学判断 | 自动化不能替代；当前无统一签收记录 | 保留人工 Owner，不伪装成自动化 |

## 4. Pure / Static Contract

从 `frontend` 目录执行的当前真实命令：

```powershell
npm run lint
npm run typecheck
npm run build
```

- lint/typecheck/build 是代码变化后的静态门禁，不证明登录、Cookie、BFF、请求副作用或真实页面流程。
- 纯展示映射、序列化、资格判断等逻辑如果可以脱离 React/Browser 独立证明，应优先形成 pure test；当前没有相应 runner，不因假设未来需求提前安装。
- 文档-only 变化只做文档、链接、diff 与范围门禁，不机械运行 frontend build。

## 5. Unit / Logic

当前前端没有 unit/component test 资产。未来只有在逻辑已经稳定抽离、错误风险真实且静态类型不能充分证明时，才选择标准轻量 runner；组件结构、文案或 selector 不应默认用脆弱快照重复维护。

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

未来合格资产必须保持薄：

1. 一个 profile 聚焦一个 Browser-native 合同，只含 1–4 个紧密相关场景。
2. 使用最小合法前置，不把教师/学生完整业务主链塞入 scripted body。
3. 只断言 Browser 不可替代事实；服务端终态复用既有 HTTP E2E，必要时才增加最小 verifier。
4. 资产、runtime、namespace 和 cleanup 各自可归属、可独立收口。
5. 当前没有合格候选，因此不创建 placeholder、Browser DB、runner、support 或 test-only UI hook。

若未来确有合格缺口而当前仍无工具，应先报告证据缺口与准入理由，再单独评估标准 Playwright；不得私建 Browser runner，也不得在本任务中安装依赖。

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

- 当前需要数据库的后端 HTTP E2E 使用 `eduforge_test`；unit / static 证据通常不连接数据库。项目没有独立 Browser acceptance database 或 Browser fixture。
- 因当前 scripted Browser 资产为 0，也没有需要长期重复准备的 Browser namespace，本任务不新增数据库、env、fixture、verifier 或 cleanup 配置。
- 任何写入型 Agent-assisted/Human smoke 在执行前必须明确环境、实际 database、合成账号/数据 ownership 与 cleanup；不得复用来源不明的服务或账号，也不得与可能清理 `eduforge_test` 的 E2E 并行。
- 如果未来形成可重复、写入型 Browser acceptance 资产，再单独设计与普通 E2E 物理隔离且 fail-closed 的用途；namespace 不能替代数据库用途隔离。

## 11. Test Selection Rules

推荐证据选择顺序：

> Pure / Static → Unit / Logic → HTTP E2E → Scripted Browser micro-profile → Agent-assisted Browser smoke → Human smoke

这不是逐层全部执行，而是选择能够可靠证明目标语义的最低成本证据：

1. HTTP 可以证明的合同，不因业务重要升级成 Browser。
2. Browser 只证明 Browser 本身不可替代的语义。
3. UI 主流程重要，不等于必须 scripted automation；客观 production UI 默认 Agent-assisted。
4. 主观体验、教学表达和真实教学判断由 Human smoke 负责。
5. 同一风险只设一个主证据 Owner；其他层只补不可替代的边界。

## 12. Explicit Non-goals

- 不追求 scripted Browser 数量、Playwright 覆盖率或 UI golden path CI。
- 不把 Browser 当作普通 API、DTO、权限、并发或数据库终态测试的替代品。
- 不批量新增前端 unit/component snapshot，不安装依赖，不建设私有 runner。
- 不把尚未实现的未来产品流程写成当前设计或 smoke 事实。
- 不在本文保存逐轮测试日志、截图清单或 release notes。

## 13. Current Known Gaps

- 前端没有 unit/logic runner；仅在出现稳定、独立且静态门禁无法证明的逻辑风险时再评估。
- 当前没有 scripted Browser 对真实 BrowserContext、reload、Cookie/credentials/CORS 或 BFF topology 提供确定性证据；Discovery 尚未发现必须立即建设的独立 Browser-native 合同。
- Agent-assisted 与 Human smoke 目前只有治理和候选范围，没有可继承的 passed evidence、专用 fixture 或结果登记；实际任务必须按真实执行模式报告。
- 写入型 Browser smoke 尚无独立数据库用途。出现重复验收需求前保持现状，比预建空基础设施更符合最低充分原则。
