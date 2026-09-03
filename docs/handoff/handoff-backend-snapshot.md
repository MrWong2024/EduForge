# 后端当前事实快照（Path Base: `backend/`）

## 0) 本文定位（强制口径）

本文是后端当前事实快照，用于新会话快速建立系统全貌；它保留强制口径、系统骨架、领域模型摘要、主链路状态、高风险边界和细节文档索引，不承载完整 API/config/testing/provider/Service 说明。

- 本项目使用 git/GitHub 进行版本管理；AI 协作开发时，代码事实以当前工作区或用户指定 commit 为准。
- 与代码冲突时，具体实现以 `backend/` 源码为最高优先级，handoff 只用于交接业务事实，不替代代码核对。
- 详细接口路径、门禁、响应/Query 口径看 `docs/handoff/handoff-backend-api-map.md`。
- 详细配置、数据库命名、env、AI provider/worker/debug 运行模式看 `docs/handoff/handoff-backend-config-matrix.md`。
- 详细 DTO 请求体看 `docs/handoff/handoff-backend-dto-cheatsheet.md`。
- 详细 Service 职责与边界看 `docs/handoff/handoff-backend-service-map.md`。
- 详细 E2E、mock server、spec 覆盖和测试命令看 `docs/handoff/handoff-backend-testing-playbook.md`。
- 后端技术栈事实：Node.js LTS 24.x、NestJS 11.x、MongoDB 8.x（Mongoose）、TypeScript、REST API。
- 前端正式后端访问路径为同域 `/api/proxy/**`，代理目标由 `FRONTEND_BACKEND_ORIGIN` 控制。

## 1) 系统骨架摘要

```text
backend/
├─ src/
│  ├─ common/{decorators,filters,guards,interfaces,types}
│  ├─ config/{configuration.ts,env.validation.ts}
│  └─ modules/
│     ├─ auth/                 # 登录、session、忘记/重置密码
│     ├─ mail/                 # 邮件发送抽象
│     ├─ users/                # 当前用户资料与改密
│     ├─ courses/              # 课程、课程总览
│     ├─ classrooms/           # 班级、看板、周报、过程性评价、导出
│     │  ├─ classroom-tasks/   # 课堂任务实例、三件套、AI 指标
│     │  └─ enrollments/       # Enrollment-only 成员关系
│     ├─ learning-tasks/       # 任务模板、提交、反馈、AI Feedback
│     │  └─ ai-feedback/       # provider、worker、processor、protocol、debug guard
│     └─ database/             # Mongo 连接与 databaseName 校验
├─ test/                       # E2E specs；清单与命令见 testing-playbook
└─ scripts/                    # sync-indexes.ts、import-users.ts
```

运行与运维入口摘要：

- 应用连接串读取 `MONGO_URI`；索引同步、用户导入等运维脚本读取 `MONGO_ADMIN_URI`。
- `NODE_ENV` 与数据库物理库名绑定：`development -> eduforge_dev`，`test -> eduforge_test`，`production -> eduforge`。
- production 索引同步入口是 `npm run sync-indexes`；离线用户导入入口是 `npm run import-users -- --file="..." [--dry-run] [--reset-password]`。

## 2) 领域模型摘要

- `User`：账号与角色承载实体，含 `email/passwordHash/roles/status/name/studentNo/employeeNo`；`passwordHash` 不对 API 返回。
- `Session`：登录态实体；服务端通过 `ef_session` HttpOnly Cookie 识别会话。
- `PasswordResetToken`：忘记/重置密码一次性 token；数据库保存 `tokenHash`，业务显式校验过期与使用状态。
- `Course`：课程实体，支持 `ACTIVE/ARCHIVED`，`courseLabel` 是可选课程分类坐标，不是外键。
- `Classroom`：班级实体，绑定 `courseId/teacherId/joinCode/status`；`studentIds` 仅 legacy 输出/镜像，不参与授权、统计或 fallback。
- `Enrollment`：成员关系唯一权威来源，当前只承载 `role=STUDENT`，状态为 `ACTIVE/REMOVED`。
- `Task`：任务模板资产，支持 `courseLabel`、`visibility(PRIVATE|SHARED)` 与生命周期 `DRAFT -> PUBLISHED -> ARCHIVED`；共享只影响读可见性，不改变作者写权限。
- `ClassroomTask`：课堂任务实例，按 `classroomId + taskId` 发布；实例状态为 `ACTIVE/CLOSED/RECALLED`，实例配置包含 `dueAt/settings.allowLate/settings.maxAttempts`。
- `Submission`：学生提交，隔离键优先看 `classroomTaskId`；持久化 `submittedAt/isLate/lateBySeconds/content.codeText/content.language`。
- `Feedback`：教师、AI、系统反馈；`tags` 与 AI feedback 共用统一词表并归一化。
- `AiFeedbackJob`：AI Feedback job 生命周期为 `PENDING/RUNNING/SUCCEEDED/FAILED/DEAD`；无 job 时前后端应展示 `NOT_REQUESTED`，这是正常产品语义。

## 3) 强制边界与高风险口径

认证与授权：

- 全局 `SessionAuthGuard` 通过 `APP_GUARD` 保护非 `@Public()` 路由；角色边界由 `RolesGuard` 与 `TEACHER/STUDENT` 承载。
- `GET /api/users/me` 是登录态与前端 role gate 锚点；`PATCH /api/users/me` 与 `GET` 返回公开字段口径一致。
- 平台不开放公开注册；当前也没有产品化管理员批量导入页面/管理接口/Excel 上传。

成员、班级与课程：

- Enrollment-only 已收口：成员授权、统计、mine 查询都只读 `Enrollment(role=STUDENT,status=ACTIVE)`；`classroom.studentIds` 不作为 fallback。
- 课程/班级支持归档、恢复和空对象删除；非空删除分别返回 `COURSE_NOT_EMPTY` / `CLASSROOM_NOT_EMPTY`，应只归档。
- 班级、课堂任务、统计聚合严禁用 `taskId` 做跨班兜底；课堂任务级统计和提交流水以 `classroomTaskId` 隔离。

任务、提交与反馈：

- 任务模板生命周期必须走动作接口；普通 `PATCH` 不再承担状态流转。
- 班级发布候选只返回当前教师可见且 `PUBLISHED` 的模板，并排除本班已发布过的模板。
- 学生新提交与学生手工请求 AI 均要求 `classroom.status=ACTIVE` 与 `classroomTask.status=ACTIVE`；模板当前状态不再阻断既有课堂任务运行。
- 到期且不允许迟交时，提交返回 `LATE_SUBMISSION_NOT_ALLOWED`；重复提交冷却由 `LEARNING_TASK_SUBMISSION_COOLDOWN_MS` 控制，命中返回 `SUBMISSION_COOLDOWN_ACTIVE`。
- 教师反馈仅允许修改 `source=TEACHER` 的条目；`AI/SYSTEM` 反馈只读。

AI Feedback：

- 默认联调模式为 `Stub + worker`，即 `AI_FEEDBACK_PROVIDER=stub` 且 `AI_FEEDBACK_WORKER_ENABLED=true`。
- `process-once` 只用于 debug/ops，受 `AI_FEEDBACK_DEBUG_ENABLED` 与 RBAC 保护；debug gate 关闭时按 `404` 处理。
- 自动入队采用 attempt-based 策略：默认首提自动入队，后续提交未手工 request 时可保持 `NOT_REQUESTED`。
- Provider、Bailian 真实调用、并发/限流/超时/重试等细节统一看 config-matrix 与 testing-playbook。

## 4) 主链路当前状态摘要

用户与账户：

- 登录、登出、session 校验、当前用户资料、当前用户改密与忘记/重置密码链路已可用。
- 防枚举、冷却、reset token 与会话失效的具体 HTTP 合同由 `handoff-backend-api-map.md` 和 `handoff-backend-dto-cheatsheet.md` 维护。

教学主链路：

- Teacher 可维护课程、班级、任务模板，并将已发布模板发布为课堂任务实例。
- Student 通过 joinCode 加入班级，读取学习看板、任务详情，提交作业并查看反馈。
- 教师成员列表、课堂任务提交列表与 Teacher/Student submission detail 均已切到稳定真接口；具体读源和权限边界由 API map 维护。
- 课堂任务实例支持关闭/恢复提交/撤回状态流，以及 `dueAt/allowLate/maxAttempts` 实例级配置更新。

聚合与分析：

- 班级看板、学生学习看板、课程总览、周报、学习轨迹、课堂复盘、AI 指标、过程性评价、AI 反馈介入成效分析与教学快照预检均已有后端能力。
- AI 反馈介入成效分析覆盖总览、任务和 ACTIVE 学生分析，并支持必要筛选；结果只反映当前合同下的提交行为与代码问题代理变化，不代表正式成绩、能力、时间趋势或因果贡献。
- 过程性评价支持临时排除任务后重新计算并提供 JSON/CSV；评分、字段、筛选与兼容口径由 API map、DTO cheatsheet 和 Service map 维护。
- 周报、课程总览、学习轨迹、复盘包、过程性评价等聚合接口均要求遵守 Enrollment-only 与 classroomTask 隔离。

## 5) 当前不可误判事项

已完成且不应回退：

- 成员授权、统计和正式成员读取只认 Enrollment，不回退到 `classroom.studentIds`。
- 课堂任务提交和聚合严格按 `classroomTaskId` 隔离，不用 `taskId` 跨班兜底。
- submission detail 使用稳定详情读源，并与轻量列表的数据暴露边界分离。
- `AI Feedback` 的产品 request 只负责确保 job，实际执行由 worker/processor 消费。
- 过程性评价任务排除是临时查询条件，不修改任务、成绩或教师偏好。

仍未完成或不属于当前产品能力：

- 公开注册。
- 产品化管理员批量导入用户能力。
- 教师手工添加学生到班级。
- 提交/成员列表高级筛选与全文搜索。
- 额外导出能力（如提交列表 CSV）。

## 6) 细节文档索引

- 接口地图：`docs/handoff/handoff-backend-api-map.md`
- DTO 写接口速查：`docs/handoff/handoff-backend-dto-cheatsheet.md`
- 配置矩阵与运行模式：`docs/handoff/handoff-backend-config-matrix.md`
- Service 职责地图：`docs/handoff/handoff-backend-service-map.md`
- 测试作战手册：`docs/handoff/handoff-backend-testing-playbook.md`
- 关键决策记录：`docs/handoff/handoff-backend-decisions.md`
- 前端入口：`docs/handoff/handoff-frontend-INDEX.md`
