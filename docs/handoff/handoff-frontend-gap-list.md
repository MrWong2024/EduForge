# 前端续接缺口清单（Gap List）

说明：

- 分类按 `P0/P1/P2` 与 `归属（frontend/backend/联动）`。
- 本清单面向新会话“下一步直接开干”。
- 已完成能力见末尾“已收口基线”，避免重复返工。

## P0（当前必须守住）

| 优先级 | 归属 | 事项 | 当前事实 | 推荐下一步 |
|---|---|---|---|---|
| P0 | 联动 | AI 闭环联调必须固定为 `Stub + worker` 模式 | 前端 request 按钮已接入，但是否流转到 `SUCCEEDED` 依赖后端 worker | 联调默认使用 `Stub + worker`，先按 `handoff-config-matrix.md` 固化环境，再做人工验收 |
| P0 | frontend | 不得回退到已移除的 workaround | members 与 classroomTask submissions 已接入真接口 | 继续基于 `GET /classrooms/:id/students` 与 `GET /classrooms/:classroomId/tasks/:classroomTaskId/submissions`，禁止重新使用 `process-assessment/taskId` 过滤兜底 |
| P0 | frontend | submission detail 继续保持“稳定读源优先” | Teacher/Student 页已接 `GET learning-tasks/submissions/:id`，仍保留 query 兜底 | 新需求继续以 detail 接口为主，不要回退为 query 主读源 |
| P0 | frontend | 所有新请求继续走 `/api/proxy/**` | 当前已统一由 `lib/api/{client,browser-client}.ts` 管理 | 新页面/组件必须复用现有 client，不要直接连后端域名 |

## P1（建议下一阶段完成）

| 优先级 | 归属 | 事项 | 当前事实 | 推荐下一步 |
|---|---|---|---|---|
| P1 | frontend | Teacher 起步链路仍可继续顺滑化 | 已支持创建课程/创建班级/发布任务，但空系统首次起步仍偏工程化 | 继续优化“课程 -> 班级 -> 发布任务”的引导、按钮位置与表单反馈，减少首次使用阻力 |
| P1 | frontend | Teacher 提交/成员页分页能力不完整 | `/submissions` 与 `/members` 当前基本固定首屏查询，翻页能力弱 | 增加 `page/limit` UI 与 URL query 同步，沿用现有 `format.ts` 工具 |
| P1 | frontend | `PublishClassroomTaskForm` 存在未落地字段提示 | `feedbackEnabled` 仅 UI 勾选，注释标明“当前接口暂不接收” | 明确为只读说明，或移除该输入，避免误导 |
| P1 | 联动 | ops/debug 可视化入口缺失 | 后端有 debug/ops 路由与门禁，前端无 `/ops/**` 页面 | 若要暴露运维页，新增受角色与开关控制的 `/ops` 路由，遵循 debug 404 口径 |

## P2（可后置优化）

| 优先级 | 归属 | 事项 | 当前事实 | 推荐下一步 |
|---|---|---|---|---|
| P2 | frontend | 用户资料编辑入口未前端化 | 后端 `PATCH /users/me` 已可用，但前端无对应页面/表单 | 后续补齐“我的资料”页或最小资料编辑入口 |
| P2 | frontend | 主链路页面仍保留大量 raw JSON `<details>` | 便于联调，但非最终交付体验 | 按页面逐步下线调试块，保留必要排障入口 |
| P2 | frontend | `_demo` 沙箱路由存在历史残留 | `/_demo/page.tsx` 内有 `/demo/*` 链接写法，且与主链路无关 | 明确标注“仅 demo”，或单独整理/清理 `_demo` |
| P2 | backend | 非 P0 功能尚未提供（前端无法补） | 后端 snapshot 明确未含批量导入、教师手工加学生、高级筛选搜索 | 前端侧暂不提前实现占位，待后端接口明确后再接入 |

## 已收口基线（避免重复建设）

- Teacher 起步链路：`创建课程 -> 创建班级 -> 发布任务 -> 进入任务工作区` 已可用。
- Student 学习链路：`加入班级 -> 任务详情 -> 提交 -> submission detail -> request AI` 已可用。
- Teacher 批阅链路：`任务提交列表 -> submission detail -> 新增教师反馈` 已可用。
- P0 真接口前端收口：`users/me`、`classrooms/:id/students`、`classroomTask submissions`、`submission detail 稳定读源` 已接入。
- 请求入口统一：业务请求统一通过 `/api/proxy/**`，代理层 method/body/header/set-cookie 已透传。
