# EduForge Frontend Architecture Baseline (V1.1.1)

版本：`V1.1.1`  
更新时间：`2026-02-20`  
权威后端基线：`docs/handoff/handoff-*.md`、`docs/auth-baseline.md`

## 0. 文档定位与范围
- 目标：提供可直接落地的 Next.js App Router 前端架构规范，支持页面批量开发与一致性验收。
- 适用范围：`frontend/app/**`、`frontend/lib/**`、前端路由权限、数据获取、错误处理、下载交互。
- 非目标：不定义视觉稿，不替代后端 API 文档，不扩展新状态管理架构。

## 1. 不可违背约束（从 handoff 抽取）
- 认证必须是服务端 Session + HttpOnly Cookie `ef_session`。
- 前端禁止 Bearer Token；请求默认携带 cookie。
- 所有后端接口路径以 `/api` 开头。
- debug/ops gate：`AI_FEEDBACK_DEBUG_ENABLED=false` 时返回 `404` 是正常门禁；前端文案必须是“功能未启用”。
- 课堂统计/报表/复盘/导出统一按 `classroomTaskId` 隔离；禁止按 `taskId` 跨班兜底聚合。
- 成员授权与统计是 Enrollment-only；禁止读取 `classroom.studentIds` 做 fallback。
- AI 语义：无 job 等于 `NOT_REQUESTED`，是正常产品状态。

## 2. RSC/Server Actions 调后端（默认路径 + 备选路径）
### 2.1 默认方案（必须优先）：BFF 代理（Next Route Handler）
- 页面（RSC/Server Actions/Client）统一请求同域 `/api/proxy/**`。
- `app/api/proxy/[...path]/route.ts` 转发到后端 `/api/**`，透传 `Cookie`，回传 `Set-Cookie`/`Content-Type`/`Content-Disposition`。
- 目标：规避跨域 cookie/CORS/CSRF 配置坑，且避免 RSC 相对路径误打到 Next 本地 API。
- 实现约束（MUST）：
  - 代理必须支持任意 HTTP method：`GET/POST/PATCH/PUT/DELETE`。
  - 必须转发请求 body（`stream` 或 `arrayBuffer` 均可）。
  - 必须转发必要请求头：至少 `cookie`、`content-type`、`accept`；其余头建议白名单透传。
  - 必须透传响应头：`content-type`、`content-disposition`、`set-cookie`。
  - `set-cookie` 可能多条，必须确保全部透传，不能只保留首条。
  - 下载代理（CSV/snapshot）要求与第 8 节一致。

最小片段（示意，真实实现必须满足上述约束）：
```ts
// app/api/proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const upstream = await fetch(`${process.env.BACKEND_URL}/api/${params.path.join('/')}${req.nextUrl.search}`, {
    method: 'GET',
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });
  const res = new NextResponse(upstream.body, { status: upstream.status });
  const ct = upstream.headers.get('content-type');
  const cd = upstream.headers.get('content-disposition');
  const sc = upstream.headers.get('set-cookie');
  if (ct) res.headers.set('content-type', ct);
  if (cd) res.headers.set('content-disposition', cd);
  if (sc) res.headers.set('set-cookie', sc);
  return res;
}
```

### 2.2 备选方案：前端直连后端
- 仅在部署层已做同域反代或跨域配置明确时启用。
- 必须使用绝对地址 `BACKEND_URL`（server-only）；不要在 RSC 使用 `fetch('/api/...')` 期待命中后端。
- 原因：RSC 在 server 端执行，`/api/...` 默认命中的是 Next 自己。

## 3. 技术栈与架构原则
- `Next.js App Router + TypeScript`。
- `Server Components` 优先，`Client Components` 仅承载交互与局部轮询。
- server-first 数据获取，避免不必要全局状态。
- 写操作优先 `Server Actions`，其次 route handler；成功后 `revalidatePath` 或 `revalidateTag`。

## 4. IA 与路由分区（Role-first）
顶层分区：
- `/login`
- `/teacher/**`
- `/student/**`
- `/ops/**`（默认隐藏入口）

推荐路由骨架（开发级）：
```text
app/
  (public)/login/page.tsx
  (teacher)/teacher/courses/page.tsx
  (teacher)/teacher/courses/[courseId]/overview/page.tsx
  (teacher)/teacher/classrooms/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/dashboard/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/weekly-report/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/process-assessment/page.tsx
  (teacher)/teacher/classrooms/[classroomId]/export/snapshot/page.tsx
  (student)/student/page.tsx
  (student)/student/join/page.tsx
  (student)/student/classrooms/[classroomId]/page.tsx
  (student)/student/classrooms/[classroomId]/tasks/[classroomTaskId]/page.tsx
  (student)/student/submissions/[submissionId]/page.tsx
  (ops)/ops/ai-feedback-jobs/page.tsx
```

动态段命名统一：
- `[courseId]`、`[classroomId]`、`[classroomTaskId]`、`[taskId]`、`[submissionId]`

后端 `:id` 映射规则（统一写法）：
- 前端路由层统一使用语义化 `classroomId/courseId`。
- 调后端时按接口契约映射：  
  - `/api/classrooms/:id/*` 的 `:id` 由前端 `classroomId` 填充。  
  - `/api/courses/:id/*` 的 `:id` 由前端 `courseId` 填充。  
  - `/api/classrooms/:classroomId/tasks/:classroomTaskId/*` 直接同名映射。

导航信息架构图（文字版）：
```text
Login -> Role Home
Teacher: /teacher/classrooms -> /teacher/classrooms/[classroomId]/dashboard
        -> /teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/(learning-trajectory|review-pack|ai-metrics)
        -> /teacher/classrooms/[classroomId]/(weekly-report|process-assessment|export/snapshot)
        -> /teacher/courses -> /teacher/courses/[courseId]/overview
Student: /student -> /student/classrooms/[classroomId] -> /student/classrooms/[classroomId]/tasks/[classroomTaskId]
        -> /student/submissions/[submissionId]
```

## 5. 认证、会话与权限策略
- 登录态探针固定为 `GET /api/users/me`。
- 推荐在 `teacher` 与 `student` 根 layout 完成会话探针与角色重定向。
- `401`：跳转 `/login`（携带 `next`）。
- `403`：显示“无权限访问该资源”。
- `404`：显示“资源不存在，或功能未启用”。
- debug/ops 特例：`AI_FEEDBACK_DEBUG_ENABLED=false` 导致的 `404` 必须展示“功能未启用”，不是“权限不足”。

### 5.1 角色首页跳转（Role Home Routing Policy）
- MUST：`roles` 包含 `TEACHER` 时，默认跳转 `/teacher/classrooms`（可带 `?page=1`）。
- MUST：否则若 `roles` 包含 `STUDENT`，默认跳转 `/student`。
- MUST：否则显示 `403`（无可用角色），并提示“请联系管理员开通角色权限”。
- 说明：未来可扩展“手动切换角色”，但 V1.1.1 仅定义默认跳转策略，不实现切换能力。

## 6. 缓存与一致性策略（避免 no-store 一刀切）
### 6.1 默认策略
- 关键业务读模型（教师/学生当前操作页）默认 `no-store`（强一致）。
- 报表窗口数据允许可控缓存：`next: { revalidate, tags }`。

### 6.2 适合 tag 缓存的页面
- `GET /api/classrooms/:classroomId/weekly-report`
- `GET /api/classrooms/:classroomId/process-assessment`
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory`
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack`
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics`
- `GET /api/courses/:courseId/overview`

建议 tag：
- `classroom:{classroomId}:weekly-report:{window}`
- `classroom:{classroomId}:process-assessment:{window}`
- `classroom-task:{classroomTaskId}:trajectory:{window}`
- `classroom-task:{classroomTaskId}:review-pack:{window}`
- `classroom-task:{classroomTaskId}:ai-metrics:{window}`
- `course:{courseId}:overview:{window}`

### 6.3 不适合缓存（应 no-store）
- `GET /api/users/me`
- `GET /api/classrooms/mine/dashboard`
- `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`
- `GET /api/learning-tasks/submissions/:id/feedback`（提交后即时查看）
- 所有与权限判定强相关的入口页数据

### 6.4 写后刷新
- 提交作业、请求 AI、加入班级后，按影响范围执行 `revalidateTag/revalidatePath`。
- 严禁只刷新局部组件但保留过期主数据。

## 7. API Client 规范（可执行）
推荐文件：
- `frontend/lib/api/errors.ts`
- `frontend/lib/api/client.ts`

规范：
- 默认走 BFF：`baseUrl = ''`，调用 `/api/proxy/**`。
- 直连后端时：`baseUrl = process.env.BACKEND_URL`（server-only），禁止暴露到 client bundle。
- 统一 body 解析兼容：`json`、`text`、`204/empty`。
- 统一错误分流：`401/403/404/500` + 业务错误码（如 `LATE_SUBMISSION_NOT_ALLOWED`）。

最小片段：
```ts
// frontend/lib/api/errors.ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
```

```ts
// frontend/lib/api/client.ts
import { ApiError } from './errors';

type FetchOpts = RequestInit & {
  baseUrl?: string; // BFF 为空字符串；直连后端传 BACKEND_URL
  nextOptions?: { revalidate?: number; tags?: string[] };
};

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const raw = await res.text();
  if (!raw) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export async function apiFetchJson<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { baseUrl = '', nextOptions, ...init } = opts;
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    next: nextOptions,
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const code = typeof body === 'object' && body && 'code' in body ? String((body as any).code) : 'HTTP_ERROR';
    const msg = typeof body === 'object' && body && 'message' in body ? String((body as any).message) : `HTTP ${res.status}`;
    throw new ApiError(res.status, code, msg, body);
  }
  return body as T;
}

export async function apiFetchText(path: string, opts: FetchOpts = {}): Promise<string> {
  const { baseUrl = '', nextOptions, ...init } = opts;
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    next: nextOptions,
  });
  const body = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', `HTTP ${res.status}`, body);
  return typeof body === 'string' ? body : '';
}
```

## 8. 下载接口规范（CSV / Snapshot）
下载接口：
- `GET /api/classrooms/:classroomId/process-assessment.csv`
- `GET /api/classrooms/:classroomId/export/snapshot`

实现约束：
- 浏览器下载优先经 route handler 代理（同域 `/api/proxy/**`）。
- 必须透传：
  - `content-type`
  - `content-disposition`
  - `set-cookie`（若存在）
- 失败状态统一处理：
  - `401` -> 跳登录
  - `403` -> 无权限提示
  - `404` -> 资源不存在或功能未启用
  - `500` -> 重试提示

Snapshot 体积保护 UX：
- UI 必须暴露导出参数：`limitStudents`、`limitAssessment`、`includePerTask`、`window`。
- 响应中若含 `meta.notes`，页面必须提示“导出结果已按限制截断”。

## 9. Page Contract Map（V1.1）
权限失败规则（默认）：`401 -> /login`，`403 -> 无权限`，`404 -> 资源不存在或功能未启用`。  
其中 ops/debug 关闭场景的 `404` 固定显示“功能未启用”。

### 9.1 Public / Teacher / Ops
| 页面（route） | 主接口（method + path） | 关键 query | 关键交互 | 权限失败展示 |
|---|---|---|---|---|
| `/login` | `POST /api/auth/login`；`GET /api/users/me` | `next` | 登录成功后按角色跳转 | `401` 显示登录失败，不暴露细节 |
| `/teacher/courses` | `GET /api/courses` | 以后端 DTO 为准（列表分页） | 进入课程总览 | 按默认规则 |
| `/teacher/courses/[courseId]/overview` | `GET /api/courses/:courseId/overview` | `window,page,limit,sort,order` | 窗口/排序切换，跳班级 | 按默认规则 |
| `/teacher/classrooms` | `GET /api/classrooms` | 以后端 DTO 为准（列表分页） | 进入班级看板 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/dashboard` | `GET /api/classrooms/:id/dashboard` | 无（handoff 未声明） | 进入任务与报表页 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/learning-trajectory` | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/learning-trajectory` | `window,page,limit,sort,order,includeAttempts,includeTagDetails` | 排序筛选、查看学生轨迹 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/review-pack` | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/review-pack` | `window,topK,examplesPerTag,includeStudentTiers,includeTeacherScript` | 课堂复盘、教学脚本 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/tasks/[classroomTaskId]/ai-metrics` | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/ai-metrics` | `window,includeTags` | 查看 AI 状态与分布 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/weekly-report` | `GET /api/classrooms/:classroomId/weekly-report` | `window,includeRiskStudentIds` | 周报筛选 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/process-assessment` | `GET /api/classrooms/:classroomId/process-assessment`；`GET /api/classrooms/:classroomId/process-assessment.csv` | JSON:`window,page,limit,sort,order`；CSV:`window` | 表格浏览、CSV 下载 | 按默认规则 |
| `/teacher/classrooms/[classroomId]/export/snapshot` | `GET /api/classrooms/:classroomId/export/snapshot` | `window,limitStudents,limitAssessment,includePerTask` | 导出快照、显示截断提示 | 按默认规则 |
| `/ops/ai-feedback-jobs` | `GET /api/learning-tasks/ai-feedback/jobs`；`POST /api/learning-tasks/ai-feedback/jobs/process-once` | 以后端 DTO 为准 | 观察队列、process-once | `404` 优先显示“功能未启用” |

### 9.2 Student
| 页面（route） | 主接口（method + path） | 关键 query | 关键交互 | 权限失败展示 |
|---|---|---|---|---|
| `/student` | `GET /api/classrooms/mine/dashboard` | 无（handoff 未声明） | 进入班级任务 | 按默认规则 |
| `/student/join` | `POST /api/classrooms/join` | 无 | 输入 joinCode 加入班级 | 按 status 分流：`400`=joinCode 无效/格式错误；`404`=班级不存在或不可加入；`403`=无权限加入（如非学生角色） |
| `/student/classrooms/[classroomId]` | `GET /api/classrooms/:id`；`GET /api/classrooms/:id/tasks` | 无（handoff 未声明） | 进入任务详情页 | 按默认规则 |
| `/student/classrooms/[classroomId]/tasks/[classroomTaskId]` | `GET /api/classrooms/:classroomId/tasks/:classroomTaskId/my-task-detail`；`POST /api/classrooms/:classroomId/tasks/:classroomTaskId/submissions` | `includeFeedbackItems,feedbackLimit` | 查看详情、提交作业 | `403` 无权限；`LATE_SUBMISSION_NOT_ALLOWED` 显示截止提示 |
| `/student/submissions/[submissionId]` | `GET /api/learning-tasks/submissions/:id/feedback`；`POST /api/learning-tasks/submissions/:submissionId/ai-feedback/request` | 以后端 DTO 为准 | 查看反馈、手工请求 AI | 按默认规则 |

## 10. AI 状态与错误码 UX 规范
`AiFeedbackStatus`：
- `NOT_REQUESTED`：正常状态，展示“请求 AI 反馈”。
- `PENDING`：排队中。
- `RUNNING`：处理中。
- `SUCCEEDED`：可查看反馈。
- `FAILED`：允许重试请求。
- `DEAD`：不可无限重试，提示联系教师/管理员。

错误映射：
- `LATE_SUBMISSION_NOT_ALLOWED`（403）：提示“提交已截止，当前任务不允许迟交”，提供“查看截止时间/联系教师/返回任务列表”。
- Join 场景（`POST /api/classrooms/join`）按 status 分流：
  - `400`：joinCode 无效或格式不正确，提示“请检查并重新输入 joinCode”。
  - `404`：班级不存在或当前不可加入，提示“请确认 joinCode 或联系教师”。
  - `403`：无权限加入（如角色不满足），提示权限原因并引导联系管理员/教师。
- `401`：登录已过期。
- `403`：权限不足。
- `404`：资源不存在或功能未启用（debug gate 场景固定“功能未启用”）。
- `500`：系统繁忙稍后重试。

## 11. Recommended Patterns 与 Hard Rules
### Recommended Patterns
- BFF 代理作为默认后端访问路径。
- 报表接口按 `window` 维度使用 tag 缓存，写操作后精准 revalidate。
- 页面级统一五态：`loading/empty/error/forbidden/not-found`。
- 下载统一走代理并标准化错误提示。

### Hard Rules
- 禁止按 `taskId` 做跨班统计或钻取。
- 禁止用 `classroom.studentIds` 参与授权或统计。
- 禁止把“无 job”误判为失败；`NOT_REQUESTED` 是合法语义。
- 禁止将 debug gate 404 显示成 403。
- 禁止前端自行推导后端口径指标（如风险学生），以接口返回为准。

## 12. 验收清单（文档执行检查）
- 接口路径是否全部为 `/api/...`。
- 是否明确默认路径为 BFF 代理，并给出 RSC/Server Actions 带 cookie 落地方式。
- 是否明确 debug gate 404 = 功能未启用。
- 是否明确 `classroomTaskId` 隔离与 Enrollment-only。
- CSV/快照下载是否具备可直接照抄的代理与错误处理约束。
