# P0 后端补齐回归检查清单

适用场景：前端接入前冒烟、阶段性交接、回归验证。  
范围：仅校验 P0 已落地能力，不扩展后续规划功能。

## 0) 前置条件

- [ ] 使用测试环境（`NODE_ENV=test`），并遵循 `docs/e2e-testing.md` 的隔离要求。
- [ ] 通过登录接口建立 Cookie Session（不使用 Bearer Token 替代基线）。
- [ ] 准备 teacher / student 测试账号、课程、班级、已发布任务与课堂任务实例数据。

## 1) Users：`/api/users/me`

- [ ] `GET /api/users/me` 返回公开字段口径（含 `name/studentNo/employeeNo`）。
- [ ] `PATCH /api/users/me` 可更新且仅可更新：`name/studentNo/employeeNo`。
- [ ] `PATCH /api/users/me` 传 `{}` 时行为稳定，不写坏数据。
- [ ] `GET /api/users/me` 与 `PATCH /api/users/me` 返回结构一致。
- [ ] 响应中不包含 `passwordHash`。
- [ ] `email/roles/status` 不会被 `PATCH /api/users/me` 改动。

## 2) Classrooms Members：`/api/classrooms/:id/students`

- [ ] `GET /api/classrooms/:id/students?page=1&limit=20` 返回 `200`，结构含 `items/total/page/limit`。
- [ ] `items[*]` 至少包含：`id/email/roles/status/name/studentNo/employeeNo/joinedAt`。
- [ ] 列表只返回 Enrollment `role=STUDENT,status=ACTIVE` 成员。
- [ ] 移除学生后（`POST /api/classrooms/:id/students/:uid/remove`）再次查询，已移除学生不再出现。
- [ ] 构造 legacy 污染（仅写入 `classroom.studentIds`）不会影响返回结果。
- [ ] 响应中不包含 `passwordHash`。

## 3) Classroom Task Submissions：`/api/classrooms/:classroomId/tasks/:classroomTaskId/submissions`

- [ ] `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions?page=1&limit=20` 返回 `200`，结构含 `items/total/page/limit`。
- [ ] `items[*]` 至少包含：`id/taskId/classroomTaskId/student/attemptNo/submittedAt/isLate/lateBySeconds/status/aiFeedbackStatus`。
- [ ] `student` 至少包含：`id/email/roles/status/name/studentNo/employeeNo`。
- [ ] 列表只认 `classroomTaskId`；同一 `taskId` 在其它班级的提交不得串入。
- [ ] 无 job 的 submission，`aiFeedbackStatus` 必须为 `NOT_REQUESTED`。
- [ ] 响应中不包含 `passwordHash`。
- [ ] 响应中不包含 `content.codeText`。

## 4) 权限与边界

- [ ] 非 teacher 访问班级成员/课堂任务提交流水接口按现有风格拒绝（`403`）。
- [ ] 非 owner teacher 访问上述 teacher 接口按现有风格拒绝（`404`）。
- [ ] 未回退到 `classroom.studentIds` 作为成员真相源。
- [ ] 未回退到 `taskId` 做跨班提交聚合。

## 5) 本步骤非目标防回归

- [ ] 未引入“教师手工加学生”新接口。
- [ ] 未引入“管理员批量导入用户（Excel/CSV）”能力。
- [ ] 未引入高级筛选/全文搜索/CSV 导出等后续能力。
