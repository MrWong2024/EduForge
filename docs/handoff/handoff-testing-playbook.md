# 测试作战手册（Testing Playbook）

## 1) 执行前提（E2E 基线）

- 强制遵循：`docs/e2e-testing.md`。
- 必须使用测试环境：`NODE_ENV=test`。
- 必须提供测试库连接：`MONGO_URI`（且应指向 test DB）。
- 默认应自动清理；仅本地调试时才设置 `KEEP_E2E_DB=1`。

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
npm run test:e2e -- learning-tasks.ai-feedback.ops.e2e-spec.ts
```

ai-feedback e2e 入口：
- `learning-tasks.ai-feedback.ops.e2e-spec.ts`
- `learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts`
- `learning-tasks.ai-feedback.guards.e2e-spec.ts`

本地调试保留数据：
```powershell
cd backend
$env:NODE_ENV="test"
$env:KEEP_E2E_DB="1"
npm run test:e2e -- classroom-learning-loop.e2e-spec.ts
```

## 3) 关键 e2e 文件与覆盖点

必须关注：
- `backend/test/classroom-learning-loop.e2e-spec.ts`
  - 覆盖：课程/班级/任务发布链路、学生入班与提交、`process-once`、教师反馈、`common-issues` 报表回归。
- `backend/test/classrooms.ai-metrics.e2e-spec.ts`
  - 覆盖：`GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`。
  - 断言维度：jobs 统计、成功率、错误码聚合（含 `RATE_LIMIT_LOCAL` 场景）、feedback 产出、`includeTags` 开关下的 tags 聚合行为。
- `backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts`
  - 覆盖：并发护栏、限流与重试窗口、Mock/Real AI provider 路径。
- `backend/test/learning-tasks.ai-feedback.ops.debug-off.e2e-spec.ts`
  - 覆盖：debug gate OFF（`AI_FEEDBACK_DEBUG_ENABLED=false`）时 teacher/admin 访问 debug/ops 返回 404。
- `backend/test/learning-tasks.ai-feedback.ops.e2e-spec.ts`
  - 覆盖：pipeline 主链路 + debug gate ON 下的角色授权（student 403、teacher/admin 200/201）。
- `backend/test/learning-tasks.ai-feedback.trigger-policy.e2e-spec.ts`
  - 覆盖：attempt-based 触发策略回归。
  - 关键断言：`attemptNo=1` 自动入队（`PENDING`）；`attemptNo>1` 默认 `NOT_REQUESTED`（无 job）；`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` 手工入队幂等并进入 `PENDING`；可选验证 `process-once` 后 `SUCCEEDED` 且可查询 feedback（mock/stub 语境）。

建议同时关注：
- `backend/test/classroom-dashboard-isolation.e2e-spec.ts`：跨班同 task 的 `classroomTaskId` 隔离口径。
- `backend/test/classroom-dashboard.e2e-spec.ts`：教师/学生看板与 `aiFeedbackStatus` 变化。
- `backend/test/learning-tasks.e2e-spec.ts`：learning-tasks 基础闭环。

## 4) token/session 获取方式

事实口径：
- 登录接口：`POST /api/auth/login`。
- 登录成功后由服务端写 `ef_session` Cookie（HttpOnly）。
- Guard：全局 `SessionAuthGuard` 从 cookie 读 token，校验后写入 `req.user={id,roles}`。

测试实践：
- e2e 使用 `supertest` 的 `request.agent()` 持久化 cookie session。
- 常见流程：先 `agent.post('/api/auth/login')`，后续复用同一 `agent` 访问受保护接口。

## 5) Mock server（存在且已用于 e2e）

来源：`backend/test/learning-tasks.ai-feedback.guards.e2e-spec.ts` 的 `startMockOpenRouter`。
补充：attempt-based 与 ai-metrics 的 e2e 不要求真实外部调用，可在 stub/mock 语境下完成回归。

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

补充：attempt-based 与 ai-metrics 的 e2e 不要求真实外部调用；仅在需要覆盖 provider 实链路时再启用本节配置。

Mock OpenRouter（E2E 常规）：
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_PROVIDER="openrouter"
$env:AI_FEEDBACK_REAL_ENABLED="true"
$env:OPENROUTER_API_KEY="test-key"
$env:OPENROUTER_BASE_URL="http://127.0.0.1:<mock-port>"
npm run test:e2e -- learning-tasks.ai-feedback.guards.e2e-spec.ts
```

Real OpenRouter（仅本地人工联调）：
```powershell
cd backend
$env:NODE_ENV="test"
$env:AI_FEEDBACK_PROVIDER="openrouter"
$env:AI_FEEDBACK_REAL_ENABLED="true"
$env:OPENROUTER_API_KEY="<real-key>"
$env:REAL_AI_E2E="1"
npm run test:e2e -- learning-tasks.ai-feedback.guards.e2e-spec.ts
```

Debug 接口门禁（如需调用 jobs/process-once）：
```powershell
$env:AI_FEEDBACK_DEBUG_ENABLED="true"
```

## 7) 与 AI 入队触发策略相关的测试要点（attempt-based）

- 无 job => `NOT_REQUESTED` 是策略结果，不是异常。
- 手工 request 仅创建/确保 `PENDING` job；执行仍由 worker/process-once 消费链路负责。
