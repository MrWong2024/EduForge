# 后端当前事实快照（Path Base: `backend/`）

## 0) 本文定位（强制口径）

本文用于新会话快速建立后端全貌，维护当前工程结构、模块能力、主教学链、高风险架构边界与真实未实现能力。接口、公开数据、内部实现、配置和测试细节由各专项 Owner 维护。

- 当前 `backend/` 源码或用户指定 commit 是实现事实的最高来源；handoff 不替代代码核对。
- 后端技术栈为 Node.js LTS 24.x、NestJS 11.x、MongoDB 8.x（Mongoose）、TypeScript 与 REST API。
- 前端正式业务访问经过同域 BFF proxy；具体调用与代理实现见 [Frontend API Map](./handoff-frontend-api-map.md)。
- 产品主线与阶段状态由 [Roadmap](./handoff-roadmap.md) 维护；专项事实入口见本文末尾索引。

## 1) 系统骨架摘要

```text
backend/
├─ src/
│  ├─ common/                  # 共享认证、角色与异常边界
│  ├─ config/                  # 配置读取与启动校验
│  └─ modules/
│     ├─ auth/                 # 登录、会话、忘记/重置密码
│     ├─ mail/                 # 邮件发送抽象
│     ├─ users/                # 当前用户资料与改密
│     ├─ courses/              # 课程、课程总览
│     ├─ classrooms/           # 班级、看板、周报、过程性评价、导出与分析
│     │  ├─ classroom-tasks/   # 课堂任务实例、提交管理、轨迹、复盘与 AI 指标
│     │  └─ enrollments/       # 权威成员关系
│     ├─ learning-tasks/       # 任务模板、提交与反馈
│     │  └─ ai-feedback/       # Job、Provider、Worker 与 Processor
│     └─ database/             # 数据库连接与实际目标校验
├─ test/                       # HTTP E2E 资产
└─ scripts/                    # 索引同步、离线用户导入等运维入口
```

数据库选择同时受运行环境与 database purpose 约束，连接前声明和连接后实际数据库都须通过校验；索引同步与离线用户导入使用受控运维入口。具体数据库、连接变量、账号和运行命令由 [Config Matrix](./handoff-backend-config-matrix.md) 维护，测试用途及进程隔离由 [Backend Testing Playbook](./handoff-backend-testing-playbook.md) 维护。

## 2) 领域模型摘要

- `User`：账号、角色与基础身份实体；凭据不进入公开投影。
- `Session` / `PasswordResetToken`：分别承载服务端登录会话与一次性密码重置凭据，认证、邮件和会话失效协作形成账户恢复链。
- `Course` / `Classroom`：课程与班级具有独立生命周期；课程分类是治理坐标，不形成额外外键或权限边界。
- `Enrollment`：成员关系唯一权威来源；`classroom.studentIds` 仅 legacy 镜像，不参与授权或统计 fallback。
- `Task` / `ClassroomTask`：任务模板资产与课堂运行实例拥有独立生命周期；模板共享不转移作者写权限，模板当前状态不重新阻断既有实例运行。
- `Submission`：学生提交；课堂链路固定以 `classroomTaskId` 为隔离主键，通用模板提交不能充当课堂实例读取或统计的兜底。
- `Feedback`：统一承载教师、AI 与系统反馈，来源和作者决定各自修改边界。
- `AiFeedbackJob`：持久化 AI Feedback 处理生命周期；没有 Job 是正常产品状态，不等于正在处理。

完整字段、状态值、公开投影和校验见 [DTO / Public Data Contract](./handoff-backend-dto-cheatsheet.md)，生命周期与公开权限见 [Backend API Map](./handoff-backend-api-map.md)，内部一致性与协作见 [Service Map](./handoff-backend-service-map.md)。

## 3) 强制边界与高风险口径

认证与资源授权：

- 非公开入口统一受服务端会话认证保护，角色检查与资源归属检查共同约束访问；前端 role gate 不能替代后端授权。
- 当前用户的 session / role probe 是前端角色入口的登录态锚点；具体接口和公开投影由 [API](./handoff-backend-api-map.md#users) / [DTO](./handoff-backend-dto-cheatsheet.md#users) 维护。

成员、课程与课堂隔离：

- Enrollment-only：授权、默认教学统计和个人班级读取均以有效学生 Enrollment 为准，不回退到成员镜像。
- 课程与班级支持归档、恢复及空对象删除；存在成员历史或教学引用的非空对象不能删除，应归档。具体拒绝条件见 [API Map](./handoff-backend-api-map.md)。
- 课堂提交、分析、报表、复盘与导出固定按 `classroomTaskId` 隔离，禁止用 `taskId` 跨班兜底。

任务、提交与反馈：

- 模板内容编辑与生命周期动作分离；班级发布候选由后端依据教师可见性、模板发布资格和本班既有发布记录决定。
- 学生提交与手工请求 AI 必须满足班级和课堂实例的运行条件，既有实例不受模板当前状态再次阻断。
- 服务端在写入入口最终执行截止、迟交与重复提交冷却门禁；客户端提示或节流不能替代这些校验。公开拒绝语义与配置分别见 [API Map](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源) 和 [Config Matrix](./handoff-backend-config-matrix.md)。
- submission detail 使用稳定详情读源，与轻量列表的数据暴露边界分离；教师只能在授权范围内修改教师来源反馈。详见 [API](./handoff-backend-api-map.md#learning-tasks) / [DTO](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)。

AI Feedback：

- 产品 request 只负责确保持久化 Job，Worker 调度与 Processor 执行独立；Provider 选择不等于后台自动消费开关。
- 自动入队具有提交次数策略，后续提交未请求 AI 时没有 Job 属于正常状态，不应隐式补成处理中。
- 受控 debug / process-once 是非产品执行入口，与 Worker 共用处理链，不能代替产品请求或后台消费模型。
- 本地桩与外部 Provider 对接已具备；具体 Provider、Worker、模型及邮件运行组合见 [Config Matrix](./handoff-backend-config-matrix.md)，内部处理与恢复见 [Service Map](./handoff-backend-service-map.md)。

## 4) 主链路当前状态摘要

用户与账户：

- 登录、登出、会话校验、当前用户资料、自助改密和忘记/重置密码链路已可用。
- 密码重置保留防枚举与会话失效边界；公开合同见 [API Auth](./handoff-backend-api-map.md#auth)，凭据处理与恢复协作见 [Service Map](./handoff-backend-service-map.md#service-card-01c)。

教学主链路：

- 教师维护课程、班级与任务模板，将已发布模板形成课堂任务实例。
- 学生通过加入码入班，查看学习任务、提交作业并读取反馈；教师可读取正式成员和实例提交，进入稳定提交详情并批阅。
- 课堂任务实例支持独立的运行状态管理、截止与提交规则配置；不把实例管理重新混回模板生命周期。具体动作和字段见 [API](./handoff-backend-api-map.md#classroom-tasksclassrooms-子资源) / [DTO](./handoff-backend-dto-cheatsheet.md#classroomtask-dto--response-family)。

聚合与分析：

- 班级/学生看板、课程总览、周报、学习轨迹、课堂复盘、AI 指标、过程性评价、AI 反馈介入成效分析及教学快照导出均已有后端能力。
- 过程性评价支持临时排除任务后重算并提供同口径 JSON/CSV；排除仅作用于本次查询，不修改教学记录或教师偏好。
- AI 反馈介入成效分析覆盖班级、任务与有效学生，并支持必要筛选；结果是提交行为与代码问题代理，不能当作成绩、能力、时间趋势或因果评价。
- 聚合能力共同遵守 Enrollment-only 与课堂实例隔离；公开数据和内部算法分别由 [DTO](./handoff-backend-dto-cheatsheet.md#query-dto--public-response读取接口) / [Service Map](./handoff-backend-service-map.md) 维护。

## 5) 当前不可误判事项

上述授权、成员来源、课堂隔离、模板/实例分层、详情读源、AI 请求/执行分离和临时分析条件均是不可回退边界。新增能力应沿既有模块及权威数据链扩展。

当前仍未提供：

- 公开注册。
- 产品化管理员批量导入页面、管理接口或 Excel 上传；已有离线导入脚本不代表具备这些产品能力。
- 教师手工添加学生到班级。
- 提交/成员列表高级筛选与全文搜索。
- 额外导出能力，例如提交列表 CSV。

## 6) 细节文档索引

- [Backend API Map](./handoff-backend-api-map.md)：endpoint、鉴权、生命周期、错误与可见副作用。
- [DTO / Public Data Contract 速查](./handoff-backend-dto-cheatsheet.md)：公开输入/返回数据、校验、默认值与安全省略。
- [Config Matrix](./handoff-backend-config-matrix.md)：配置、数据库映射、运行模式与运维入口。
- [Service Map](./handoff-backend-service-map.md)：内部职责、协作、一致性、隔离与恢复。
- [Backend Testing Playbook](./handoff-backend-testing-playbook.md)：测试资产、证据职责、数据库用途与进程治理。
- [Decisions](./handoff-backend-decisions.md)：稳定决策及历史背景。
- [Frontend INDEX](./handoff-frontend-INDEX.md)：前端专项 Owner 入口。
