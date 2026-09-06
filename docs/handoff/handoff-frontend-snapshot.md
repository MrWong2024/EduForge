# 前端当前事实快照（Path Base: `frontend/`）

## 0) 本文定位（强制口径）

本文用于新会话快速建立前端全貌，维护当前工程形态、角色与页面族、主链路能力、高风险边界和真实未实现能力，不维护页面说明书或 helper 清单。

- 当前 `frontend/` 源码或用户指定 commit 是实现事实的最高来源；与 handoff 冲突时先核对代码。
- 前端采用 Next.js App Router，按 Server Component / Client Component 分工；所有正式业务请求统一走同域 `/api/proxy/**`，业务页不得绕过 BFF 直连后端。
- 产品阶段与下一主线由 [Roadmap](./handoff-roadmap.md) 维护；路由、调用、组件、设计与证据分别由专项 Owner 维护，入口见本文末尾索引。

## 1) 前端骨架摘要

```text
frontend/
├─ app/
│  ├─ (auth)/                  # 登录与密码恢复页面族
│  ├─ teacher/                 # 教师角色入口与教学页面
│  ├─ student/                 # 学生角色入口与学习页面
│  ├─ api/                     # 同域 BFF 与隔离的 demo 接口
│  └─ _demo/                   # 本地 demo 沙箱，非主交付链
├─ components/                 # 角色 Shell、共享区块及领域交互组件
└─ lib/                        # API client/type adaptation、认证会话、
                               # 路由常量与共享展示语义
```

Server 侧负责会话读取、页面数据加载与组合，Client 侧承载表单和交互请求；二者共用 BFF 架构，服务端转发入站会话 Cookie，浏览器携带同域 Cookie。具体代理实现、配置与 helper 定位见 [Frontend API Map](./handoff-frontend-api-map.md)。

## 2) 路由分区摘要

Auth：

- 登录、当前用户探针与按角色进入主界面的链路已完成。
- 忘记/重置密码已接真实接口，保持防枚举提示和重置凭据不持久化的边界。

Teacher：

- 教师页面族有独立 server-side role gate；覆盖课程、班级、模板、课堂任务、成员、提交批阅及教学分析。
- 课程和班级已支持创建、基础编辑、归档、恢复与受后端约束的空对象删除。
- 模板层承担资产维护，课堂实例层承担已发布模板的选择、发布与实例管理；两层职责不混用。
- 提交管理、学习轨迹、课堂复盘与 AI 指标共享课堂任务上下文。
- 过程性评价、AI 反馈介入成效分析及其他报表已接后端权威聚合；页面用途与具体交互见 [Route Map](./handoff-frontend-route-map.md)。

Student：

- 学生页面族有独立 server-side role gate；看板、加入班级、任务详情、提交、提交详情与 AI 请求均已接真接口。
- 任务详情读取后端聚合数据，消费完成与参与状态，模板当前状态不作为前端二次阻断依据。

辅助：

- demo 沙箱及其内存接口与正式主链路隔离。
- 当前没有正式运维前端页面；受控后端诊断入口不代表已具备产品化运维 UI。

## 3) 公共机制与职责边界

- Server / Client 调用分别处理入站会话转发与浏览器同域请求，统一经 BFF 读取后端；错误解析和响应适配集中维护。
- Teacher / Student 入口以服务端当前用户探针建立角色边界，前端 gate 不能替代后端资源授权。
- 主链路路径与任务上下文集中复用，避免页面各自维护导航规则；具体模块职责见 [Component Map](./handoff-frontend-component-map.md)。
- payload adaptation 与共享展示语义集中处理，不在页面深层散写原始后端字段访问，也不据此重新推导权威业务数据。
- 模板治理、实例管理和报表筛选各守职责；具体组件与交互状态由 Component Map 维护，真实 Query 与 mapper 由 Frontend API Map 维护。

## 4) 主链路可用性摘要

Teacher 起步与教学链路：

1. 创建课程与班级，进入班级看板。
2. 创建和维护模板，使用正式后端筛选与分页能力查找模板。
3. 从后端发布候选池选择已发布模板，配置课堂实例后发布。
4. 通过任务详情、提交管理、学习轨迹、复盘和 AI 指标完成教学观察与批阅。
5. 使用课程总览、周报、过程性评价、AI 反馈介入成效分析及教学快照预检；临时分析条件不改变教学记录。

Student 学习链路：

1. 入班后从学习看板查看当前、近期过期或显式历史任务。
2. 在任务详情读取任务说明、评分标准、完成情况和历史提交。
3. 提交代码后进入稳定 submission detail 查看反馈，在允许状态下请求 AI Feedback。
4. AI Feedback 生命周期已有统一展示与状态驱动自动刷新；具体数据合同见 [Backend DTO](./handoff-backend-dto-cheatsheet.md#submission-request--response-family)，刷新组件职责见 [Component Map](./handoff-frontend-component-map.md)。

## 5) 真接口收口状态

Teacher / Student 主链路已接真实后端：账户、教学容器、模板与实例、成员、提交与反馈，以及教学报表和分析均有正式调用链。当前用户资料可读取，后端资料编辑能力尚无前端 UI。

调用点、helper、BFF、请求/响应适配及兼容行为由 [Frontend API Map](./handoff-frontend-api-map.md) 维护；公开 HTTP 行为与数据形状分别由 [Backend API](./handoff-backend-api-map.md) / [Backend DTO](./handoff-backend-dto-cheatsheet.md) 维护。

## 6) 高风险边界与当前实现边界

不得回退：

- 正式业务请求必须经过同域 `/api/proxy/**`。
- submission detail 主体来自稳定详情接口；URL query 只承担上下文与受限展示兼容，不覆盖后端权威字段。
- 模板资产与课堂实例职责分离，不以模板当前状态重新阻断既有实例的学生运行态；参与和完成状态消费后端结果。
- 过程性评价只消费后端评分；任务排除仅为临时查询条件，不持久化为教学事实或教师偏好。
- AI 反馈介入成效分析不重算后端结果或指标分母，不从学生分页重算班级摘要；不可比数据不能误表示为真实持平，也不能据此宣称成绩、能力或因果贡献。
- raw JSON 不能成为主产品视图或主链路操作前提。

当前实现边界：

- 部分页面仍有低权重 raw JSON 调试块；正式运维页面、模板删除/复制/批量操作及资料编辑 UI 尚未提供。
- 已有 non-UI scripted Browser evidence / micro-profile，不等于产品 UI 已验收；实际证据边界由 [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md) 维护。
- 当前页面族与真实主链路不代表未来学习证据产品形态已经实现；阶段见 [Roadmap](./handoff-roadmap.md)，稳定产品与交互原则见 [Design Baseline](./handoff-frontend-design-baseline.md)。

## 7) 细节文档索引

- [Frontend INDEX](./handoff-frontend-INDEX.md)：前端专项 Owner 导航。
- [Route Map](./handoff-frontend-route-map.md)：页面用途、访问边界与实现状态。
- [Frontend API Map](./handoff-frontend-api-map.md)：helper、BFF、调用链与数据适配。
- [Component Map](./handoff-frontend-component-map.md)：模块位置、组合及修改边界。
- [Design Baseline](./handoff-frontend-design-baseline.md)：稳定 UX、视觉与交互原则。
- [Frontend Testing Playbook](./handoff-frontend-testing-playbook.md)：Browser 与 smoke 证据职责。
- [Backend API](./handoff-backend-api-map.md)、[Backend DTO](./handoff-backend-dto-cheatsheet.md)、[Config Matrix](./handoff-backend-config-matrix.md)：后端公开合同与运行配置。
