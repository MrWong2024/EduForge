# EduForge Frontend Manual Checklist (Step 12)

本清单用于人工验收，不是架构说明文档。  
每一项都包含“可执行动作 + 预期结果”。

## 1. 环境准备

- [ ] 启动后端（建议 Stub + worker 模式）  
  预期：后端可正常响应 API，请求 AI 后 job 能被 worker 消费。
- [ ] 启动前端并设置 `FRONTEND_BACKEND_ORIGIN=http://localhost:5000`  
  预期：前端页面可通过 `/api/proxy/**` 正常访问后端。
- [ ] 登录 Teacher / Student 账号  
  预期：`/api/proxy/users/me` 返回当前登录态，页面按角色进入对应区域。

建议后端联调环境（示例）：

```powershell
$env:AI_FEEDBACK_PROVIDER="stub"
$env:AI_FEEDBACK_REAL_ENABLED="false"
$env:AI_FEEDBACK_WORKER_ENABLED="true"
$env:AI_FEEDBACK_WORKER_INTERVAL_MS="3000"
$env:AI_FEEDBACK_WORKER_BATCH_SIZE="5"
```

## 2. Teacher 起步链路（空系统）

- [ ] 打开 `/teacher/courses`  
  预期：空态明确提示“先创建课程，再创建班级”，并有“创建课程”入口。
- [ ] 在课程页创建课程  
  预期：创建成功后进入课程总览或返回课程列表并可看到新课程。
- [ ] 从课程页或课程总览进入班级列表  
  预期：入口清晰，支持带 `courseId` 上下文到班级页创建班级。
- [ ] 在 `/teacher/classrooms` 创建班级  
  预期：可选择课程并创建，成功后进入班级看板或返回班级列表可见新班级。

## 3. Teacher 教学主链路

- [ ] 进入 `/teacher/classrooms/[classroomId]/tasks` 发布课堂任务  
  预期：可选择已有任务发布；空态时有“发布任务”入口。
- [ ] 打开三件套页面（learning-trajectory / review-pack / ai-metrics）  
  预期：页面可访问，路由与返回链正常。
- [ ] 打开 `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/submissions`  
  预期：只展示当前 classroomTask 的提交记录。
- [ ] 进入 `/teacher/submissions/[submissionId]` 并新增教师反馈  
  预期：可查看提交内容、反馈历史，新增反馈后可在历史中看到记录。
- [ ] 打开成员页并移除成员  
  预期：成员列表可见；移除后列表刷新，成员状态变化符合预期。

## 4. Student 学习链路

- [ ] 打开 `/student/dashboard`（空账号）  
  预期：空态提示先加入班级，并有“去加入班级”入口。
- [ ] 打开 `/student/classrooms/join` 输入 joinCode 加入班级  
  预期：加入成功后回到看板可看到班级与任务。
- [ ] 进入 `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` 并提交  
  预期：提交成功后列表出现新的 submission 记录。
- [ ] 从任务详情进入 `/student/submissions/[submissionId]`  
  预期：可查看提交信息、反馈列表，并可请求 AI 反馈。

## 5. AI 闭环观察点

- [ ] 无 job 的 submission detail  
  预期：`aiFeedbackStatus` 显示 `NOT_REQUESTED`（正常状态）。
- [ ] 点击请求 AI 后立即刷新  
  预期：状态进入 `PENDING` 或 `RUNNING`。
- [ ] 等待 worker 消费后刷新  
  预期：状态进入 `SUCCEEDED`，反馈列表出现 AI 反馈项。

## 6. 报表与导出

- [ ] 打开 `/teacher/classrooms/[classroomId]/weekly-report`  
  预期：周报可读，错误态文案与 detail 格式正确。
- [ ] 打开 `/teacher/classrooms/[classroomId]/process-assessment` 并导出 CSV  
  预期：JSON 与 CSV 都可访问，下载链路可用。
- [ ] 打开 `/teacher/classrooms/[classroomId]/export/snapshot`  
  预期：可见导出说明、参数切换；若 `meta.notes` 存在则显示截断提示。

## 7. P0 真接口核对

- [ ] 登录态锚点：`/api/proxy/users/me`  
  预期：返回当前用户与角色信息。
- [ ] 成员真接口：`/api/proxy/classrooms/:id/students`  
  预期：成员页以该接口为真相，不依赖聚合替代来源。
- [ ] 提交列表真接口：`/api/proxy/classrooms/:classroomId/tasks/:classroomTaskId/submissions`  
  预期：仅返回当前 classroomTask 范围内提交。

## 8. 主视图去工程化检查

- [ ] 核心页主视图可完成操作，不需要先看 raw JSON  
  预期：主要信息都在表格/卡片中可读。
- [ ] raw JSON 仍可查看但默认折叠  
  预期：通过“查看原始数据（调试用）” `<details>` 展开查看。
