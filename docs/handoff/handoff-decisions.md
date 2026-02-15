# 关键决策记录（Decisions）

## 1) 引入 `classroomTaskId` 做数据隔离（Submission/Job/聚合口径）

**Decision**  
在课堂场景下，`Submission` 与 `AiFeedbackJob` 均携带 `classroomTaskId`，教师/学生 dashboard 聚合以该字段为主键。  

**Rationale**  
同一 `taskId` 可被多个班级复用；若仅按 `taskId` 统计会跨班串数。  
`classroom-dashboard-isolation.e2e-spec.ts` 明确验证了跨班隔离。  

**Consequences**  
提交、队列、看板三层口径一致，可稳定支持“同任务跨班复用”。  
后续新增报表时默认应优先保留 `classroomTaskId` 维度。  

## 2) 护栏在 Processor 层生效（覆盖 worker + process-once）

**Decision**  
并发控制与本地限流统一放在 `AiFeedbackProcessor` 调用链中，由 `AiFeedbackGuardsService` 执行。  

**Rationale**  
worker 与 debug 的 `process-once` 都走同一 processor，护栏只放一处即可避免策略分叉。  
`learning-tasks.ai-feedback.ops.e2e-spec.ts`、`learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts` 与 `learning-tasks.ai-feedback.guards.e2e-spec.ts` 共同覆盖了该链路回归。  

**Consequences**  
无论后台定时消费还是手工触发，都会遵守同一并发与速率上限。  
调优只需改 env，不需要改两套路由。  

## 3) tags 词表必须单一来源（`getFeedbackTags/normalizer`）

**Decision**  
tags 词表只在 `feedback-normalizer.ts` 维护，协议层通过 `getFeedbackTags()` 引用，不建立第二份词表。  

**Rationale**  
若 prompt/protocol/provider 各有一份 tags，会造成模型输出与落库规则漂移。  
当前协议常量直接绑定 `getFeedbackTags()`，已形成单一 SoT。  

**Consequences**  
新增/调整 tags 只改一处，协议和归一化自动同步。  
未知 tag 一律映射 `other`，降低脏数据风险。  

## 4) 严格 JSON 协议 + prompt 资产化 + 解析收敛（可回归）

**Decision**  
OpenRouter provider 只接受严格 JSON 对象，字段白名单、值域白名单与解析流程固定在 protocol/prompt/provider 三件套。  

**Rationale**  
外部模型输出天然不稳定，必须通过协议收敛为可验证结构。  
当前实现对 root/item key、枚举值、meta 结构都做了硬校验。  

**Consequences**  
协议可回归测试，解析失败可定位到明确错误码（如 `BAD_RESPONSE`）。  
模型升级时只要遵守协议，不影响下游存储与报表结构。  

## 5) debug/运维接口必须环境门禁（`AI_FEEDBACK_DEBUG_ENABLED` 默认关闭）

**Decision**  
`/learning-tasks/ai-feedback/jobs*` 接口由 `AiFeedbackDebugEnabledGuard` 门禁；默认 `false`。  

**Rationale**  
该类接口用于队列可观测与手工触发，不应在默认环境暴露。  
当前 guard 在关闭时直接返回 `404`，减少接口暴露面。  

**Consequences**  
线上默认不可见，需显式开启才可调试。  
E2E 中相关用例都会先设置 `AI_FEEDBACK_DEBUG_ENABLED=true`。  

## 6) 会话模型采用服务端 Session + HttpOnly Cookie，并限制会话上限

**Decision**  
认证采用 `sessions` 集合 + Cookie `ef_session`，并保留每用户最多 5 个会话。  

**Rationale**  
`docs/auth-baseline.md` 明确要求可控失效、TTL 回收与会话上限治理。  
`AuthService.login` 在成功登录后会清理超额历史会话。  

**Consequences**  
支持多端登录但避免会话无限增长。  
认证失效控制在服务端，不依赖客户端 token 自行管理。  

## 7) RBAC 已启用并默认 enforce（兼容期开关可回滚）

**Decision**  
`RolesGuard` 已启用并真正执行角色校验：`@Public()` 直通；未命中 `@Roles(...)` 元数据的受保护路由默认 `403`；兼容期可用 `AUTHZ_ENFORCE_ROLES=false` 暂时关闭 enforce。  

**Rationale**  
认证与授权职责已分层：`SessionAuthGuard` 负责登录态，`RolesGuard` 负责角色授权，service 继续保留资源级兜底校验防绕过。  
默认 deny 可避免遗漏注解导致的“隐式放行”风险。  

**Consequences**  
controller 的 `@UseGuards(RolesGuard) + @Roles(...)` 成为授权主门禁，service 校验作为第二道防线。  
出现兼容性风险时可通过 `AUTHZ_ENFORCE_ROLES=false` 快速回滚，再逐步补齐注解与用例。  

## 8) 数据库环境必须 fail-fast（运行期与运维脚本双重校验）

**Decision**  
`DatabaseModule` 与 `scripts/sync-indexes.ts` 都要求 DB 名与 `NODE_ENV` 命名约定匹配，不匹配立即报错退出。  

**Rationale**  
防止误连 dev/prod 库执行测试或索引同步。  
该规则与 `docs/database-conventions.md`、`docs/e2e-testing.md` 的隔离要求一致。  

**Consequences**  
跨环境误操作风险显著降低。  
配置错误会在启动早期暴露，避免“运行后才发现污染数据”。  

## 9) AI 运行指标报表必须以 `classroomTaskId` 为统计主键

**Decision**  
新增 AI 运行指标报表（ai-metrics）时，所有统计必须以 `classroomTaskId` 作为聚合主键，不允许按 `taskId` 跨班汇总。  

**Rationale**  
同一 `taskId` 可被多个班级复用；若按 `taskId` 统计将破坏课堂隔离语义，导致跨班串数。  

**Consequences**  
所有与 AI 运行相关的报表、成功率、错误分布、反馈产出统计默认继承 `classroomTaskId` 维度。  
后续新增统计能力时，应优先保留该隔离维度，不得回退为 `taskId` 聚合。  

## 10) AI 入队触发采用 attempt-based 策略治理

**Decision**  
AI 反馈的自动入队不再默认“每次提交都触发”，而采用基于提交次数（attempt）的策略控制模型：首提自动入队，后续提交默认不自动入队。  

**Rationale**  
避免重复提交导致队列与外部调用成本失控，同时保留“即时反馈助教”的教学定位。  

**Consequences**  
提交后是否入队成为一个明确的策略控制点，而非隐式行为。  
系统需能够区分“未处理”与“未请求”的语义。  
成本治理从执行层扩展到触发层，形成双层控制结构。  

## 11) 手工触发 AI 入队属于产品能力，与 debug/运维能力分层

**Decision**  
手工触发 AI 入队被定义为产品级能力，而非 debug/运维能力；两类能力必须在权限与门禁层面分离。  

**Rationale**  
debug/运维接口默认受环境门禁控制；产品能力需在权限校验下长期开放，不应依赖 debug 开关。  

**Consequences**  
手工触发接口必须受认证与资源归属校验保护。  
debug 门禁仍保持默认关闭，不因产品能力而放宽。  
AI 触发与 AI 执行保持分层设计，避免职责混淆。  

## 12) `aiFeedbackStatus` 语义统一：无 Job 即 `NOT_REQUESTED`

**Decision**  
AI 状态推导统一口径：存在 Job 映射为执行态；不存在 Job 视为 `NOT_REQUESTED`，而非隐式 `PENDING`。  

**Rationale**  
在 attempt-based 策略下，“未入队”具有明确业务语义，必须稳定可观测，并与 dashboard/报表统计一致。  

**Consequences**  
状态推导逻辑必须以“是否存在 Job”为第一判断。  
后续新增报表或接口不得将“无 Job”误判为执行中。  
AI 行为从“隐式默认入队”转变为“显式请求驱动”。  
