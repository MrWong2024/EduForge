# Database Conventions & Index Governance

本文档定义 EduForge 项目的数据库命名、账号权限与索引治理规则。
所有开发、测试、运维行为必须遵循本约定。

---

## 1. 数据库命名与环境隔离

数据库按运行环境进行物理隔离，禁止共库使用。

| Environment | Database Name   |
|------------|------------------|
| development| eduforge_dev     |
| test       | eduforge_test    |
| production | eduforge         |

原则：
- 不同环境必须使用不同数据库
- 禁止 development / test 连接 production 数据库
- 启动与运维脚本中必须校验当前连接的 databaseName

---

## 2. 账号与权限模型

每个环境使用两类 MongoDB 账号：

### 2.1 应用账号（*_app）
用途：
- 应用运行时连接数据库

权限：
- readWrite（仅限对应数据库）

约定：
- 应用程序 **只能** 使用 *_app 账号
- 禁止在应用运行时使用 admin / root 账号

---

### 2.2 运维账号（*_db_admin）
用途：
- 索引同步
- 数据迁移
- 运维操作

权限：
- dbOwner（或等效运维权限）

约定：
- *_db_admin 账号 **仅用于人工或脚本执行**
- 不得写入应用配置或源码

---

## 3. autoIndex 策略

Mongoose 的 autoIndex 按环境严格区分：

| Environment | autoIndex |
|------------|-----------|
| development| true      |
| test       | false     |
| production | false     |

说明：
- development：提升开发效率，Schema 变更即时生效
- test / production：避免启动阻塞与不可控索引创建

---

## 4. 索引同步（唯一合法入口）

当 Schema 中的索引发生变更时，必须通过以下方式同步：

```powershell
npm run sync-indexes
```
要求：

执行前必须设置 NODE_ENV

脚本内部会强制校验 databaseName

索引同步使用 *_db_admin 账号完成

禁止通过 autoIndex 或临时脚本在 test / production 建索引

示例（PowerShell）：
```powershell
$env:NODE_ENV="development"
npm run sync-indexes
```

## 5. 禁止事项（红线）

禁止应用使用 root / admin 账号

禁止跨环境共用数据库

禁止在 production 启用 autoIndex

禁止绕过 sync-indexes 手工建索引
