# 数据库命名、账号权限与索引治理规范

本文档定义 MongoDB 数据库命名、环境隔离、账号权限、`autoIndex` 策略、索引同步、集合命名、Schema 索引变更和运维边界。  
适用于采用 MongoDB + Mongoose 的后端工程。  
本文档不定义具体业务集合和业务字段；具体业务数据模型由后端模块 Schema 和业务文档定义。  
Mongoose Schema 技术红线与 Codex 执行规则以 `docs/codex-rules.md` 为准；后端架构职责以 `docs/backend-architecture.md` 为准；认证会话集合原则以 `docs/auth-baseline.md` 为准。

---

## 1. 数据库命名与环境隔离

数据库必须按运行环境物理隔离，禁止 development、test、staging、production 共库使用。

推荐命名模板：

- development：`<app>_dev`
- test：`<app>_test`
- staging：`<app>_staging`
- production：`<app>` 或 `<app>_prod`

说明：

- 具体数据库名由环境变量、部署文档或 `.env.example` 明确。
- 本文档只定义命名模式和隔离原则，不把某个具体数据库名写成当前项目事实。
- 启动、测试、运维脚本应校验当前连接的 `databaseName`，防止误连 production。
- production 数据库不得被本地开发和自动化测试连接。

---

## 2. 账号与权限模型

### 2.1 应用账号

推荐命名模板：

- `<app>_<env>_app`

用途：

- 应用运行时连接数据库

权限原则：

- 仅对应数据库的 `readWrite`
- 不得使用 `root`、`admin`、`dbOwner` 作为应用运行账号
- 不得拥有跨库权限，除非有明确架构决策

### 2.2 运维账号

推荐命名模板：

- `<app>_<env>_db_admin`

用途：

- 索引同步
- 数据迁移
- 一次性修复
- 受控运维脚本

权限原则：

- `dbOwner` 或满足运维脚本需求的最小权限
- 不得写入应用运行配置或源码
- 不得由应用进程常驻使用

### 2.3 只读账号（可选）

可按需要提供只读账号，例如：

- `<app>_<env>_read`

用途：

- 只读报表
- 审计查询
- 人工核查

权限原则：

- `read`
- 不作为必需账号

### 2.4 凭证管理

- 数据库账号、连接串、密码、密钥不得进入仓库。
- 相关凭证应由环境变量、密钥管理或部署平台提供。

---

## 3. autoIndex 策略

建议策略：

- development：可启用 `autoIndex`
- test：可启用 `autoIndex`
- staging：建议按 production 口径关闭，或仅在受控场景启用
- production：必须关闭 `autoIndex`

production 关闭 `autoIndex` 的原因：

- 避免应用启动时阻塞
- 避免不可控索引创建
- 避免生产高峰期触发大规模索引构建

补充说明：

- `autoIndex` 配置应由环境变量或配置模块统一管理。
- 不得在业务代码中临时启用 production `autoIndex`。
- Mongoose Schema 中仍可声明索引，但 production 同步必须走受控流程。

---

## 4. 索引同步与受控流程

在 production 或正式索引治理流程中，Schema 索引发生变更时，必须通过受控索引同步流程处理。

受控流程可以是：

- 项目提供的索引同步脚本
- 运维脚本
- 数据库迁移流程
- DBA 或运维平台执行流程

执行原则：

- 如项目提供索引同步脚本，应优先通过该脚本执行。
- 实际命令以 `backend/package.json`、部署文档和运维流程为准。
- 未初始化项目不得假设某个脚本已经存在。

索引同步前必须确认：

- 当前环境
- 当前 `databaseName`
- 使用账号类型
- 目标索引变更内容
- 影响范围
- 回滚或降级方案，尤其是 production

额外约束：

- production 禁止依赖 `autoIndex` 自动建索引
- production 禁止临时、无记录、无审核的随手索引变更
- production 人工建索引必须纳入受控运维流程，有记录、有确认、有回滚或降级方案

---

## 5. 集合命名与字段命名约定

### 5.1 集合命名

- 使用小写复数或项目统一约定
- 避免混用单数和复数
- 避免缩写不明的集合名
- 避免与 MongoDB 系统集合、保留名称或已有集合冲突

### 5.2 字段命名

- 推荐使用 `camelCase`
- `_id` 保持 MongoDB 默认语义
- 外键引用字段通常使用 `<entity>Id`
- 数组引用字段通常使用 `<entity>Ids`
- 时间字段建议使用语义明确名称，例如：
  - `createdAt`
  - `updatedAt`
  - `deletedAt`
  - `expiresAt`
  - `lastSeenAt`

### 5.3 软删除

- 如项目采用软删除，建议统一使用 `deletedAt` 或语义明确的状态字段
- 本文档不强制所有集合必须使用软删除
- 是否采用软删除由业务模型和合规要求决定

---

## 6. Schema 与索引变更规则

### 6.1 新增字段

新增 Schema 字段时，应明确：

- 是否必填
- 默认值
- 是否需要索引
- 是否影响历史数据
- 是否需要迁移脚本或兼容读取逻辑

### 6.2 修改字段语义

- 不得仅修改字段注释或变量名就视为完成变更
- 必须考虑历史数据兼容
- 必须考虑 DTO、Service、前端调用和导入导出影响

### 6.3 删除字段

- 应先完成代码兼容和数据迁移
- production 中避免直接依赖“字段已不存在”
- 必要时采用灰度删除策略

### 6.4 新增索引

新增索引时，应明确：

- 查询场景
- 是否唯一
- 是否稀疏或 partial
- 是否 TTL
- production 构建成本

### 6.5 删除或修改索引

- 明确受影响查询
- 明确回滚方案
- production 必须受控执行

---

## 7. TTL、唯一索引与部分索引原则

### 7.1 TTL 索引

- 用于会话、临时 token、一次性验证码、短期任务记录等有明确生命周期的数据
- TTL 字段必须是 `Date` 类型
- 过期删除不是实时强一致，不得用作精确计时业务逻辑
- `sessions.expiresAt` 的 TTL 原则可参考 `docs/auth-baseline.md`

### 7.2 unique 索引

- 用于邮箱、用户名、业务唯一编号、session token 等唯一约束
- 必须明确大小写、空值、历史数据和软删除场景的影响
- 如存在软删除或可选字段，应评估 `partialFilterExpression`

### 7.3 compound 索引

- 按主要查询条件和排序方式设计
- 避免为每个字段机械建索引
- 避免重复、冗余、长期无用索引

### 7.4 partial / sparse 索引

- 仅在明确查询语义和数据分布时使用
- 需要在 Schema 或索引治理记录中说明用途

---

## 8. 数据迁移与运维脚本边界

### 8.1 数据迁移脚本

数据迁移脚本应满足以下要求：

- 明确目标环境
- 明确 `databaseName`
- 具备 dry-run 或可核查输出，production 尤其需要
- 记录影响数量
- 对关键变更提供回滚或补救方案
- 不在业务服务启动流程中偷偷执行大规模迁移

### 8.2 运维脚本

运维脚本应满足以下要求：

- 使用运维账号
- 不写死 production 连接串
- 读取环境变量或受控配置
- 对危险环境进行二次确认
- 输出关键执行信息，但不输出敏感凭证

### 8.3 Codex 边界

- Codex 不得在没有明确任务要求时创建或执行迁移脚本
- Codex 执行边界以 `docs/codex-rules.md` 为准

---

## 9. 禁止事项（红线）

- 禁止应用运行时使用 `root`、`admin`、`dbOwner` 账号
- 禁止 development、test 连接 production 数据库
- 禁止 production 启用 Mongoose `autoIndex`
- 禁止将数据库账号、连接串、密码、密钥写入仓库
- 禁止绕过受控流程在 production 临时建索引、删索引或改索引
- 禁止无备份、无 dry-run、无影响评估地执行 production 大规模数据修改
- 禁止仅凭 Codex 推断自行改动生产数据库治理策略
- 禁止为解决局部查询问题机械添加大量索引

---

## 10. 验收与核查建议

涉及数据库配置变更时，可按影响范围核查：

- 环境变量
- `databaseName`
- `autoIndex`
- 账号类型

涉及索引变更时，可按影响范围核查：

- Schema 中索引声明
- 实际数据库索引
- 同步脚本或运维流程
- production `autoIndex` 未启用

涉及会话、TTL、唯一约束时，可按影响范围核查：

- TTL 字段类型
- unique 索引是否存在
- 软删除或空值场景是否处理

说明：

- 命令示例只能作为可选示例，不应写死为所有项目必须执行
- 具体测试、lint、build 和 Codex 验证边界以 `docs/codex-rules.md` 为准

---

## 11. 与相关文档的职责关系

- `docs/codex-instruction-spec.md`：Codex 指令结构
- `docs/codex-rules.md`：Codex 执行规则、依赖治理、Git 安全、验证规则、Mongoose 技术红线
- `docs/backend-architecture.md`：后端架构、模块分层和 Schema 职责
- `docs/auth-baseline.md`：认证、sessions 集合、Cookie 和会话安全
- `docs/frontend-architecture.md`：前端 BFF、路由、会话协作和 UI 处理
- `docs/e2e-testing.md`：E2E 测试组织和环境

如出现数据库治理说明与其他文档的内容重叠，应按各文档职责边界理解；本文档只定义数据库治理本身。
