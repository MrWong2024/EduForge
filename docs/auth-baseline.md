# 身份与会话基线规范

本文档定义认证、会话、Cookie、Guard、用户上下文、角色权限基线、认证探针和安全错误语义。  
适用于采用 NestJS + MongoDB/Mongoose + Next.js 前端协作的全栈项目。  
本文档不定义具体业务角色集合，不定义具体业务权限矩阵；具体角色、权限与页面入口可由业务文档或 handoff 文档定义。  
Codex 执行边界以 `docs/codex-rules.md` 为准；前端协作口径以 `docs/frontend-architecture.md` 为准；后端架构口径以 `docs/backend-architecture.md` 为准。

---

## 1. 认证模型选择

主登录态采用：服务端会话（Session-based Auth） + HttpOnly Cookie。

基线结论：

- 主登录态不采用纯无状态 JWT。
- 不把会话信息写入用户主集合。
- JWT 可作为特定场景的临时凭证或外部集成令牌，但不作为主登录态，除非后续架构决策明确调整。

采用服务端会话的原因：

- 服务端可控失效
- 可限量
- 可审计
- 可主动清理
- 更适合后台管理、协同系统和权限敏感系统

---

## 2. sessions 集合设计

### 2.1 最小字段

建议 `sessions` 集合至少包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `userId` | 所属用户 |
| `token` | 服务端会话标识，必须唯一 |
| `expiresAt` | 会话过期时间，配合 TTL 索引 |
| `createdAt` | 由 `timestamps` 管理 |
| `updatedAt` | 由 `timestamps` 管理 |

可选字段，可按业务需要引入：

- `userAgent`
- `ip`
- `lastSeenAt`
- `revokedAt`

### 2.2 索引原则

`sessions` 集合应至少具备以下索引：

- `userId` 查询索引
- `token` unique 索引
- `expiresAt` TTL 索引

具体索引创建、同步与运维边界以 `docs/database-conventions.md` 为准。  
如需人工核查，可使用数据库客户端或运维脚本查看现有索引，这类命令仅作为可选示例，不构成本文档的固定执行步骤。

---

## 3. Cookie 策略

Cookie 名称应使用通用配置项或统一约定，例如：

- `SESSION_COOKIE_NAME`
- `<app>_session`

Cookie 属性原则：

- `HttpOnly` 必须启用
- `SameSite` 默认 `Lax`
- `Secure` 在 production 环境必须启用
- `Path` 默认为 `/`
- `Max-Age` 与 session TTL 对齐

补充说明：

- `Domain` 是否设置由部署拓扑决定
- 跨站点部署、第三方嵌入或多域名场景，需要重新评估 `SameSite`、`Secure` 与 CORS 策略
- 前端不得直接读取 HttpOnly Cookie；前端仅通过认证探针或受保护接口判断登录态

---

## 4. 会话生命周期策略

### 4.1 登录成功

登录成功后应完成以下动作：

- 创建新 session
- 写入 `sessions` 集合
- 下发 HttpOnly Cookie
- 返回用户公开信息，或由前端随后调用认证探针获取

### 4.2 会话上限

- 同一用户的最大有效会话数应由配置项控制，例如 `MAX_ACTIVE_SESSIONS_PER_USER`
- 如未显式配置，可采用保守默认值；例如建议默认 5，但不应把该值写成当前项目事实
- 超出上限时，应按明确策略处理，通常优先回收最旧会话

### 4.3 会话失效

会话失效至少应覆盖以下路径：

- TTL 自动回收
- Guard 被动校验
- logout 主动失效

可选扩展：

- 管理侧强制失效
- 安全事件触发的批量撤销

---

## 5. Guard 与用户上下文

### 5.1 SessionAuthGuard

`SessionAuthGuard` 的基线职责：

- 从 Cookie 读取 session token
- 校验 session 是否存在、未过期、未撤销
- 支持 `@Public()` 路由直通
- 校验通过后挂载 `req.user`
- 校验失败抛 `UnauthorizedException` 或统一认证异常

### 5.2 用户上下文

`req.user` 建议至少包含：

- `id`
- `roles`

按业务需要可选补充：

- `permissions`
- `sessionId`
- `tenantId`
- `organizationId`

### 5.3 RolesGuard 与权限基线

- `RolesGuard` 不默认全局化
- `@Roles(...)` 由具体路由显式使用
- 权限校验可基于 RBAC、权限码或组合策略实现
- 具体角色名、权限码和数据范围规则不在本文档定义
- 如需举例，可使用 `roleA`、`roleB` 或 `<role>`

---

## 6. 认证探针接口

项目应提供一个认证探针接口，路径由具体项目约定，推荐：

- `GET /api/auth/me`
- `GET /api/users/me`

该接口的职责：

- 校验 HttpOnly Cookie 对应的服务端 session
- 返回当前用户公开字段、角色和必要权限摘要
- 不返回 `passwordHash`、`token`、`secret`、`credential` 等敏感字段

前端使用原则：

- 前端通过认证探针或受保护接口确认登录态
- `401` 跳转登录
- `403` 展示无权限
- 具体 UI 处理以 `docs/frontend-architecture.md` 为准

---

## 7. 错误语义统一

认证失败场景对外不应泄露具体失败原因，包括但不限于：

- 未登录
- 会话不存在
- 会话过期
- 会话撤销
- token 错误
- 用户不存在
- 密码错误

对外语义约束：

- 上述场景可统一返回 `401 Unauthorized`
- 已认证但无权限时返回 `403 Forbidden`
- 不得泄露账号是否存在、密码是否错误、session 是否存在等敏感细节

通用响应示例：

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

前端可根据 `status` 或 `code` 映射友好文案，但后端不应泄露安全敏感原因。

---

## 8. 敏感字段与输出安全

普通响应不得返回以下敏感字段或安全凭证：

- `password`
- `passwordHash`
- session token
- reset token
- `secret`
- `credential`
- refresh token
- 其他安全凭证

输出安全原则：

- 用户公开信息应经过 DTO、mapper 或 serializer 控制
- 不得直接返回完整用户文档
- `select: false`、DTO 剔除、序列化剔除等实现方式由后端架构和实际代码决定

---

## 9. 前后端协作口径

登录协作：

- 后端设置 HttpOnly Cookie
- 前端不读取 Cookie 内容
- 前端根据响应或认证探针更新 UI 状态

登出协作：

- 后端清除 Cookie
- 后端使 session 失效
- 前端清除本地非敏感 UI 状态并跳转登录页或公共页

BFF 协作：

- 当前端请求通过同域 BFF 代理转发时，由 BFF 透传 Cookie
- `set-cookie` 必须透传
- 具体 BFF 规则以 `docs/frontend-architecture.md` 为准

跨域协作：

- 需要明确 CORS、credentials、`SameSite`、`Secure`、`Domain` 策略
- 本文档不写死部署形态

---

## 10. 验收建议

涉及认证、会话、Guard、Cookie、权限的代码变更时，应按影响范围选择执行以下核查：

- `sessions` 索引存在
- 登录成功后 session 创建、Cookie 下发
- 未登录访问受保护接口返回 `401`
- 登录后访问认证探针返回当前用户公开信息
- logout 后原 Cookie 不再可访问受保护接口
- 会话过期后访问受保护接口返回 `401`
- 无权限访问返回 `403`
- 敏感字段不出现在响应中

说明：

- 不要求所有任务机械执行全部核查
- 具体测试命令和执行边界以 `docs/codex-rules.md` 与 `docs/e2e-testing.md` 为准

---

## 11. 结论性约束

> 主登录态是服务端资产，不是客户端自管凭证。任何认证与会话相关改动，都必须保证：可控失效、可回收、可限量、可审计、敏感信息不外泄。

---

## 12. 与相关文档的职责关系

- `docs/codex-instruction-spec.md`：Codex 指令结构
- `docs/codex-rules.md`：Codex 执行规则、依赖治理、Git 安全、验证规则
- `docs/backend-architecture.md`：后端架构、模块分层和 API 风格
- `docs/frontend-architecture.md`：前端 BFF、路由、会话协作和 UI 处理
- `docs/database-conventions.md`：数据库治理、索引与集合命名
- `docs/e2e-testing.md`：E2E 测试组织和环境

如出现认证与会话基线和其他文档的说明重叠，应按各文档职责边界理解；本文档仅定义身份与会话基线本身。

