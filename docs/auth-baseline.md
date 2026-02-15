
# Auth Baseline（身份与会话基线规范）

> 适用于 EduForge 后端（NestJS + MongoDB）
> 本文档用于**固定认证与会话的工程约束**，防止后续模块或重构破坏登录闭环。

---

## 1. 认证模型选择（结论先行）

**采用：服务端会话（Session-based Auth） + HttpOnly Cookie**

明确不采用：

* 纯无状态 JWT（无法强制失效、不可控）
* 将会话信息塞入 users 表（反模式）

---

## 2. 会话存储设计（sessions 集合）

### 2.1 Collection：`sessions`

**用途**：持久化登录会话，实现服务端可控登录态。

最小字段：

| 字段          | 含义               |
| ----------- | ---------------- |
| `userId`    | 所属用户             |
| `token`     | 会话标识（唯一）         |
| `expiresAt` | 会话过期时间（TTL）      |
| `createdAt` | 创建时间（timestamps） |

---

### 2.2 索引规范（强制）

`sessions` 集合必须存在以下索引：

* `userId_1`：查询索引
* `token_1 (unique)`：防止 token 冲突
* `expiresAt_1 (expireAfterSeconds: 0)`：**TTL 自动清理**

> 验收命令：

```js
db.sessions.getIndexes()
```

---

## 3. 会话生命周期策略（关键治理点）

### 3.1 会话创建

* 每次 `POST /api/auth/login` 成功：

  * 创建新 session
  * 写入 `sessions` 集合
  * 下发 HttpOnly Cookie（`ef_session`）

---

### 3.2 会话上限策略（必须）

**策略：允许多端，但限制上限**

* 同一 `userId` **最多保留 N 个有效会话**（当前 N=5）
* 超出上限：

  * 自动删除**最旧会话**
* 防止：

  * 会话无限增长
  * 灌水攻击
  * 长期存储膨胀

> 验收命令：

```js
db.sessions.countDocuments({ userId })
```

---

### 3.3 会话失效

* **TTL 自动回收**：MongoDB 后台清理过期会话
* **被动校验失效**：Guard 校验时发现过期 → 立即拒绝
* **logout**：

  * 清 cookie
  * 同时使服务端 session 失效（删除或过期）

---

## 4. Cookie 策略（协议层）

Cookie 名称：`ef_session`

属性规范：

| 属性         | 说明                   |
| ---------- | -------------------- |
| `HttpOnly` | 必须                   |
| `SameSite` | `Lax`（本地/同站）         |
| `Secure`   | `true`（仅 production） |
| `Path`     | `/`                  |
| `Max-Age`  | 与 session TTL 对齐     |

---

## 5. Guard 与用户上下文

### 5.1 SessionAuthGuard 职责（基于 HttpOnly Cookie 的 Session Guard）

* 从 request cookie 读取 `ef_session`
* 校验 session 是否存在且有效
* 支持 `@Public()` 路由直通（全局 guard 白名单）
* 校验通过：

  * 基于 `validateSession` 挂载 `req.user = { id, roles }`
* 校验失败：

  * 抛 `UnauthorizedException`

### 5.2 Guard 提供方式（架构约束）

* `SessionAuthGuard`：

  * **由 AuthModule 提供并导出**
  * **由 AppModule 通过 `APP_GUARD` 全局挂载**
  * 其它模块只使用，不自行 provide
* 避免模块“装配耦合”
* `RolesGuard` 不全局化，仍由路由显式 `@UseGuards(RolesGuard) + @Roles(...)` 控制授权

---

## 6. /users/me 行为规范（闭环锚点）

* 路由：`GET /api/users/me`
* 角色：登录态探针接口（用于确认 cookie session 与用户上下文已建立）
* 访问条件：

  * 必须通过 `SessionAuthGuard`
* 返回：

  * 当前用户**公开字段**
  * 严禁返回 `passwordHash`

---

## 7. 错误语义统一（安全红线）

### 7.1 对外 message 统一

所有认证失败场景：

* 未登录
* 会话无效
* 登录失败（密码错误）

**统一返回：**

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

目的：

* 不泄露失败原因
* 防止账号枚举
* 前端统一处理

---

## 8. 验收清单（任何改动 auth 必跑）

### 必跑 1：TTL 索引

```js
db.sessions.getIndexes()
```

### 必跑 2：会话上限

```js
db.sessions.countDocuments({ userId })
```

### 必跑 3：未登录访问

```http
GET /api/users/me → 401 Unauthorized
```

---

## 9. 结论性约束（一句话版）

> **EduForge 的登录态是“服务端资产”，不是客户端凭证。**
> 任何改动 Auth 的代码，必须保证：
> **可控失效、可回收、可限量、可审计。**

---
