# 测试作战手册（Testing Playbook）

## 1) 执行前提（E2E 基线）

- 强制遵循：`docs/e2e-testing.md`。
- 必须使用测试环境：`NODE_ENV=test`。
- 必须提供测试库连接：`MONGO_URI`（且应指向 test DB）。
- 默认应自动清理；仅本地调试时才设置 `KEEP_E2E_DB=1`。
- 影响模块装配、provider 绑定、guard 行为的 env（如 `AI_FEEDBACK_DEBUG_ENABLED`、`AI_FEEDBACK_PROVIDER`、`AI_FEEDBACK_REAL_ENABLED`、`AI_FEEDBACK_WORKER_ENABLED`）必须在应用初始化 / `AppModule` 导入前设置；否则可能出现与业务无关的 `404` 或 provider/guard 装配偏差。

## 2) 运行命令（PowerShell）

说明：本节命令仅作为人类手工运行示例，不作为 Codex 执行步骤要求。

全量 e2e：
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e
```

单个 spec（示例）：
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/learning-tasks.ai-feedback.ops.e2e-spec.ts
```
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts
```

常用单个 spec 入口（新增能力）：
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/classroom-learning-trajectory.e2e-spec.ts
```
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/classroom-review-pack.e2e-spec.ts
```
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/classroom-process-assessment.e2e-spec.ts
```
```powershell
cd backend
$env:NODE_ENV="test"
Remove-Item Env:KEEP_E2E_DB -ErrorAction SilentlyContinue
npm run test:e2e -- backend/test/classroom-export-snapshot.e2e-spec.ts
```

推荐默认联调模式（结论）：
- `Stub + worker`（用于本地开发 / 前后端联调 / AI 闭环验证）。
- 最小关键 env：`AI_FEEDBACK_PROVIDER=stub`、`AI_FEEDBACK_REAL_ENABLED=false`、`AI_FEEDBACK_WORKER_ENABLED=true`。
- worker 默认轮询间隔 `10000ms`（可由 `AI_FEEDBACK_WORKER_INTERVAL_MS` 覆盖）；空跑 tick（processed/succeeded/failed/dead 全 0）默认不输出结果 DEBUG 日志。
- 产品级 request 只负责创建/确保 `PENDING` job，worker 负责消费到 `SUCCEEDED`。
- `process-once` 仅用于 debug/ops 辅助，不作为默认交付运行模式。

ai-feedback e2e 入口：
- `learning-tasks.ai-feedback.ops.e2e-spec.ts`
- `learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts`
- `learning-tasks.ai-feedback.guards.e2e-spec.ts`
- `learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts`
- `learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts`

本地调试保留数据：
```powershell
cd backend
$env:NODE_ENV="test"
$env:KEEP_E2E_DB="1"
npm run test:e2e -- backend/test/classroom-learning-loop.e2e-spec.ts
```

## 3) 关键 e2e 文件与覆盖点

必须关注：
- `backend/test/classroom-learning-loop.e2e-spec.ts`
  - 覆盖：课程/班级/任务发布链路、学生入班与提交、`process-once`、教师反馈、`common-issues` 报表回归。
- `backend/test/classrooms.ai-metrics.e2e-spec.ts`
  - 覆盖：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`。
  - 断言维度：jobs 统计、成功率、错误码聚合（含 `RATE_LIMIT_LOCAL` 场景）、feedback 产出、`includeTags` 开关下的 tags 聚合行为。
- `backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts`
  - 覆盖：并发护栏、限流与重试窗口、Mock/Real AI provider 路径、落库前收敛上限回归。
  - 关键断言：mock provider 即使返回 25 条 `items`，单 submission 最终 AI feedback 持久化条数仍收敛为 `<=2`。
- `backend/test/learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts`
  - 覆盖：mock OpenRouter 请求体捕获与 prompt 上下文断言（`TaskTitle/TaskDescription/TaskRubric/Code/AIUsageDeclaration`）。
  - 关键断言：system prompt 明确要求简体中文输出（教学反馈文本字段默认中文）并包含“主问题导向收敛”硬约束（默认 1 条、最多 2 条、同类问题合并、阻断问题优先、禁止表扬噪音）以及合法/非法输出形状示例；空数组边界已收紧为“仅 truly no-feedback 内容时允许”，正确但可改进场景必须返回 1 条综合反馈；`language` 仅作 hint（缺失/冲突时优先按代码判断语言）；反馈主链路可持久化并可查询。
  - 补充：测试通过直接调用 `aiFeedbackProcessor.processOnce(1)` 推进 job，属于测试辅助推进方式，不是默认产品运行模式。
- `backend/test/learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts`
  - 覆盖：debug gate OFF（`AI_FEEDBACK_DEBUG_ENABLED=false`）时 teacher/admin 访问 debug/ops 返回 404。
- `backend/test/learning-tasks.ai-feedback.ops.e2e-spec.ts`
  - 覆盖：pipeline 主链路 + debug gate ON 下的角色授权（student 403、teacher/admin 200/201）。
- `backend/test/learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts`
  - 覆盖：attempt-based 触发策略回归。
  - 关键断言：`attemptNo=1` 自动入队（`PENDING`）；`attemptNo>1` 默认 `NOT_REQUESTED`（无 job）；`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` 手工入队幂等并进入 `PENDING`；可选验证 `process-once` 后 `SUCCEEDED` 且可查询 feedback（mock/stub 语境）。
  - 说明：该 spec 显式将 `LEARNING_TASK_SUBMISSION_COOLDOWN_MS` 设为 `0`，避免提交冷却影响“连续尝试触发策略”断言。
- `backend/test/enrollments.authority-and-legacy.e2e-spec.ts`
  - 覆盖：Enrollment-only 权威来源收口，成员关系以 Enrollment 为准。
  - 关键断言：`classroom.studentIds` 仅镜像输出，不作为授权/统计读源。
  - 重要性：防止文档与实现被误读为可回退 legacy 口径。
- `backend/test/enrollment-only.regression.e2e-spec.ts`
  - 覆盖：Enrollment-only 反作弊回归，测试内直写污染 `classroom.studentIds` 场景。
  - 关键断言：污染后仍不能越权，且不影响统计、mine、overview 等结果。
  - 重要性：锁定“studentIds 不能回滚为业务真相”的回归边界。
- `backend/test/classroom-weekly-report.e2e-spec.ts`
  - 覆盖：AA `GET /api/classrooms/:classroomId/weekly-report`。
  - 关键断言：`risk=activeStudents-submittedDistinctStudents`，`lateStudentsCount/lateSubmissionsCount` 存在且为 number。
  - 重要性：保证周报口径与 Enrollment-only、迟交维度一致。
- `backend/test/course-overview.e2e-spec.ts`
  - 覆盖：AB `GET /api/courses/:courseId/overview`。
  - 关键断言：`studentsCount` 来源 Enrollment grouped-count，包含 late 维度字段，排序/分页语义为页内排序。
  - 重要性：保证课程总览聚合口径不跨班泄漏。
- `backend/test/classroom-student-task-detail.e2e-spec.ts`
  - 覆盖：Z3 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`。
  - 关键断言：`includeFeedbackItems/feedbackLimit` 生效，`attempt>1` 可能 `NOT_REQUESTED`（无 job 合法语义）。
  - 重要性：保证学生端聚合详情与 attempt-based 语义一致。
- `backend/test/classroom-learning-trajectory.e2e-spec.ts`
  - 覆盖：Z4 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`（teacher）。
  - 关键断言：`items[*].student` 含 `id/name/studentNo/email`（并兼容 `studentName`）；未提交学生也在 `items` 且带 student 公开信息；响应不包含 `passwordHash`；`includeTagDetails=false` 跳过 tags unwind；`attempts[].isLate/lateBySeconds` 存在（Z7）；`includeAttempts=true` 时 `attempts[*].feedbackCount` 存在且覆盖有反馈 `>0` / 无反馈 `=0`，同时 `feedbackSummary.totalItems` 保留 AI 摘要语义。
  - 重要性：锁定轨迹分页口径与迟交字段传播。
- `backend/test/classroom-review-pack.e2e-spec.ts`
  - 覆盖：Z5 `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`。
  - 关键断言：examples 不含 `codeText/prompt/apiKey`；overview 含 late 维度；响应不再包含 `actionItems/teacherScript`；`studentTiers` 基于最新提交稳定分层（`good/watch/notSubmitted` 不得在 `studentsCount>0 && submittedStudentsCount>0` 时全空），并验证 `latestErrorCount` 仅按最新提交的 `AI+ERROR` 统计。
  - 重要性：保证复盘包可教学使用且无敏感字段泄漏。
- `backend/test/classroom-process-assessment.e2e-spec.ts`
  - 覆盖：Z6 `GET /api/classrooms/:classroomId/process-assessment` 与 `GET /api/classrooms/:classroomId/process-assessment.csv`。
  - 关键断言：CSV header/转义正确，不含敏感字段；`lateSubmissionsCount/lateTasksCount` 存在（Z7）。
  - 重要性：保证过程性评价 JSON/CSV 同口径可导出。
- `backend/test/classroom-task-deadline.e2e-spec.ts`
  - 覆盖：Z7 `POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 的截止门禁。
  - 关键断言：`dueAt` 到期且 `allowLate=false` 返回 `LATE_SUBMISSION_NOT_ALLOWED`；`submittedAt/isLate/lateBySeconds` 持久化语义正确。
  - 重要性：保证截止规则与迟交数据链路一致。
- `backend/test/classroom-task-submission-cooldown.e2e-spec.ts`
  - 覆盖：课堂任务提交冷却（同一 `studentId + classroomTaskId`）。
  - 关键断言：默认冷却命中返回 `429/SUBMISSION_COOLDOWN_ACTIVE`；超窗后允许再次提交；`LEARNING_TASK_SUBMISSION_COOLDOWN_MS=0` 时可连续提交。
- `backend/test/classroom-task-submissions.e2e-spec.ts`
  - 覆盖：P0 `GET /api/learning-tasks/submissions/:id` 稳定读源（含 classroomTask 隔离场景） + `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` 列表契约。
  - 关键断言：学生本人可读；classroom owner teacher 可读；非授权 teacher/student 返回 `403`；返回 `content.codeText`；无 job 时 `aiFeedbackStatus=NOT_REQUESTED`；提交列表 `feedbackCount` 覆盖有反馈 `>0` 与无反馈 `=0` 两种场景。
- `backend/test/classroom-export-snapshot.e2e-spec.ts`
  - 覆盖：Z9 `GET /api/classrooms/:classroomId/export/snapshot`。
  - 关键断言：`includePerTask=false` 时 perTask 省略且 `meta.notes` 提示；对 stringify 结果断言不包含 `"codeText"`。
  - 重要性：保证导出体积保护与敏感字段禁出策略。

建议同时关注：
- submission detail 主视图回归建议成对验证：`GET /api/learning-tasks/submissions/:id` 与 `GET /api/learning-tasks/submissions/:id/feedback`，避免只验 feedback 而漏掉 detail 读源。
- `backend/test/classroom-dashboard-isolation.e2e-spec.ts`：跨班同 task 的 `classroomTaskId` 隔离口径。
- `backend/test/classroom-dashboard.e2e-spec.ts`：教师/学生看板与 `aiFeedbackStatus` 变化。
- `backend/test/learning-tasks.e2e-spec.ts`：learning-tasks 基础闭环（含 `GET /api/learning-tasks/submissions/:id` 在 `classroomTaskId=null` 场景下 task owner teacher 可读，以及教师反馈标签词表校验：未知标签返回 `400` 固定文案、未传 tags 自动落 `other`）。

### 新增能力覆盖矩阵（Z3~Z9）

| 能力 | 接口 | 对应 e2e 文件 |
|---|---|---|
| Z3 my-task-detail | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail` | `backend/test/classroom-student-task-detail.e2e-spec.ts` |
| AA weekly-report | `GET /api/classrooms/:classroomId/weekly-report` | `backend/test/classroom-weekly-report.e2e-spec.ts` |
| AB course overview | `GET /api/courses/:courseId/overview` | `backend/test/course-overview.e2e-spec.ts` |
| Z4 learning-trajectory | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory` | `backend/test/classroom-learning-trajectory.e2e-spec.ts` |
| Z5 review-pack | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack` | `backend/test/classroom-review-pack.e2e-spec.ts` |
| Z6 process-assessment + CSV | `GET /api/classrooms/:classroomId/process-assessment` + `GET /api/classrooms/:classroomId/process-assessment.csv` | `backend/test/classroom-process-assessment.e2e-spec.ts` |
| Z7 deadline/late | `POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`（同时回归 late 字段在 weekly/trajectory/review-pack/process-assessment/snapshot 等聚合接口中的传播） | `backend/test/classroom-task-deadline.e2e-spec.ts` |
| Z9 export snapshot | `GET /api/classrooms/:classroomId/export/snapshot` | `backend/test/classroom-export-snapshot.e2e-spec.ts` |
| Enrollment-only regression | 成员授权/统计相关接口（Enrollment-only 回归） | `backend/test/enrollments.authority-and-legacy.e2e-spec.ts`、`backend/test/enrollment-only.regression.e2e-spec.ts` |

## 4) token/session 获取方式

事实口径：
- 登录接口：`POST /api/auth/login`。
- 登录成功后由服务端写 `ef_session` Cookie（HttpOnly）。
- Guard：全局 `SessionAuthGuard` 从 cookie 读 token，校验后写入 `req.user={id,roles}`。

测试实践：
- e2e 使用 `supertest` 的 `request.agent()` 持久化 cookie session。
- 常见流程：先 `agent.post('/api/auth/login')`，后续复用同一 `agent` 访问受保护接口。

## 5) Mock server（存在且已用于 e2e）

来源：
- `backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts` 的 `startMockOpenRouter`
- `backend/test/learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts` 的 `startMockOpenRouter`
补充：`openrouter-context` spec 的 mock server 会捕获请求体（`messages`），用于断言 task 上下文片段与“默认简体中文输出”prompt 约束。多数聚合回归可在 stub/mock 下完成；provider 实链路再启用 REAL_AI_E2E。

路由：
- `POST /chat/completions`

返回 JSON 摘要示例（短）：
```json
{
  "choices": [
    {
      "message": {
        "content": "{\"items\":[{\"type\":\"STYLE\",\"severity\":\"WARN\",\"message\":\"Mock item 1\",\"tags\":[\"readability\"]}],\"meta\":{\"model\":\"mock\"}}"
      }
    }
  ]
}
```

## 6) 在测试中注入 OPENROUTER 与 Provider 配置

补充：Z3~Z9 新聚合 e2e（含 attempt-based 与 ai-metrics）默认不要求真实外部调用，可在 stub/mock 语境下回归；仅在需要覆盖 provider 实链路时再启用本节配置。

Mock OpenRouter（E2E 常规）：
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_PROVIDER="openrouter"
$env:AI_FEEDBACK_REAL_ENABLED="true"
$env:OPENROUTER_API_KEY="test-key"
$env:OPENROUTER_BASE_URL="http://127.0.0.1:<mock-port>"
npm run test:e2e -- backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts
```
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_PROVIDER="openrouter"
$env:AI_FEEDBACK_REAL_ENABLED="true"
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
$env:OPENROUTER_API_KEY="test-key"
$env:OPENROUTER_BASE_URL="http://127.0.0.1:<mock-port>"
npm run test:e2e -- backend/test/learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts
```

Real OpenRouter（仅本地人工联调）：
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_PROVIDER="openrouter"
$env:AI_FEEDBACK_REAL_ENABLED="true"
$env:OPENROUTER_API_KEY="<real-key>"
$env:REAL_AI_E2E="1"
npm run test:e2e -- backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts
```

Debug 接口门禁（如需调用 jobs/process-once）：
```powershell
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
```
补充：当 `AI_FEEDBACK_DEBUG_ENABLED=false` 时，`POST /api/learning-tasks/ai-feedback/jobs/process-once` 返回 `404` 属正常门禁行为。
补充：`learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts` 当前实践会设置 `AI_FEEDBACK_DEBUG_ENABLED=true` 作为测试辅助环境；该 spec 推进 job 通过 service 层 `aiFeedbackProcessor.processOnce(1)` 完成，并非依赖 debug 路由，也不改变“默认联调模式为 Stub + worker”的结论。

## 7) 与 AI 入队触发策略相关的测试要点（attempt-based）

- 无 job => `NOT_REQUESTED` 是策略结果，不是异常。
- 手工 request 仅创建/确保 `PENDING` job；执行仍由 worker/process-once 消费链路负责。
- 聚合回归优先 stub/mock；provider 实链路验证时再启用 `REAL_AI_E2E=1`（详见第 6 节）。

## Changelog（本次更新）

- `enrollments.authority-and-legacy.e2e-spec.ts`
- `enrollment-only.regression.e2e-spec.ts`
- `classroom-weekly-report.e2e-spec.ts`
- `course-overview.e2e-spec.ts`
- `classroom-student-task-detail.e2e-spec.ts`
- `classroom-learning-trajectory.e2e-spec.ts`
- `classroom-review-pack.e2e-spec.ts`
- `classroom-process-assessment.e2e-spec.ts`
- `classroom-task-deadline.e2e-spec.ts`
- `classroom-task-submission-cooldown.e2e-spec.ts`
- `classroom-export-snapshot.e2e-spec.ts`
- `learning-tasks.ai-feedback.openrouter-context.e2e-spec.ts`
- 补充：submission detail 稳定读源测试关注点（`GET /api/learning-tasks/submissions/:id`）。
- 固化：默认联调模式为 `Stub + worker`，并补充影响模块装配/guard 的 env 设置时机提醒。
- 补充：AI feedback context spec 已纳入入口；覆盖 mock OpenRouter prompt 请求体中的 task 上下文片段与简体中文输出约束断言。
- 补充：AI feedback 收敛单测 `src/modules/learning-tasks/ai-feedback/lib/feedback-item-compactor.spec.ts` 已覆盖同类错误合并、低价值 INFO 过滤、ERROR 优先与“最多 2 条”约束。
- 补充：主控制策略已前移到 prompt/协议层；compactor 定位保持轻量兜底，不作为主要控制手段扩张。
