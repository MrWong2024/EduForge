# 前端架构规范（Next.js）

本文档定义 `frontend\` 前端工程的目录结构、路由组织、数据获取、BFF 代理、组件分层、错误处理、缓存刷新和架构演进口径。  
适用于采用 Next.js App Router + TypeScript 的前端工程。  
本文档不承担 Codex 指令模板和 Codex 执行边界职责；Codex 指令结构以 `docs/codex-instruction-spec.md` 为准，Codex 执行规则以 `docs/codex-rules.md` 为准；认证、会话、角色和权限口径以 `docs/auth-baseline.md` 为准。

---

## 1. 通用架构基线

- Next.js App Router + TypeScript
- Server Components 优先
- Server-first 数据获取
- 写操作可使用 Server Actions 或 Route Handler，但应结合当前项目实际约定
- 写后应根据影响范围使用 `revalidatePath`、`revalidateTag` 或显式重新获取数据
- 不引入未明确要求的全局状态管理库
- 依赖治理以 `docs/codex-rules.md` 为准

---

## 2. 不可违背约束

- 前端请求后端时应优先通过 BFF 代理。
- 前端不得在 client bundle 暴露服务端敏感环境变量。
- Server Components、Server Actions、Route Handler 与 Client Components 的职责必须清晰。
- 认证和权限口径以 `docs/auth-baseline.md` 为准。
- 后端错误 `code`、`message` 原则上不直接作为最终中文 UI 文案；前端 UI 层可做友好提示映射。
- 当后端以 `404` 隐藏未启用功能或受限能力时，前端应根据业务错误码或接口契约展示“功能未启用”或“资源不存在”等友好提示。

---

## 3. BFF 代理与服务端请求规则

### 3.1 默认方案

- 页面、RSC、Server Actions、Client Components 统一请求同域 `/api/proxy/**`。
- `app/api/proxy/[...path]/route.ts` 转发到后端 `/api/**`。
- 代理层负责透传 Cookie、请求体、必要请求头和必要响应头。

代理约束：

- 支持常见 HTTP method：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`。
- 转发请求 body。
- 透传必要请求头，至少包括 `cookie`、`content-type`、`accept`。
- 透传必要响应头，至少包括 `content-type`、`content-disposition`、`set-cookie`。
- 多条 `set-cookie` 不得丢失。

### 3.2 RSC 调后端规则

- Next.js Server Components 运行在服务端环境中，不应使用相对 `/api/...` 期待直接命中后端服务。
- 如需通过同域访问后端，优先调用 BFF 代理。
- 仅在部署、反向代理和环境变量约定都明确时，才考虑服务端直连后端。

### 3.3 文件下载与导入导出

- 文件下载、导入导出、二进制响应、带 `Content-Disposition` 的响应，优先经 BFF 代理统一处理。
- BFF 代理必须透传 `Content-Type` 与 `Content-Disposition`。
- 不应把二进制响应强行按 JSON 解析。
- 前端应根据文件名、 MIME type 和响应头处理下载行为。

---

## 4. 路由组织与信息架构

顶层路由分区可按角色、工作区或系统能力组织，以下仅为通用示例，不代表当前项目已实现：

- `/login`
- `/dashboard`
- `/workspace/**`
- `/resources/**`
- `/settings/**`
- `/admin/**`
- `/system/**` 或 `/ops/**`

通用路由骨架示例：

```text
app/
  (auth)/login/page.tsx
  (main)/dashboard/page.tsx
  (main)/workspace/page.tsx
  (main)/workspace/resources/page.tsx
  (main)/workspace/resources/[resourceId]/page.tsx
  (main)/workspace/resources/[resourceId]/items/page.tsx
  (main)/workspace/resources/[resourceId]/items/[itemId]/page.tsx
  (main)/settings/page.tsx
  (admin)/admin/users/page.tsx
  (admin)/admin/users/[userId]/page.tsx
  (system)/system/files/[fileId]/page.tsx
```

动态段命名建议：

- `[resourceId]`
- `[itemId]`
- `[userId]`
- `[fileId]`
- `[recordId]`

组织原则：

- 路由段应表达清晰语义。
- 前端动态段命名应与后端接口契约建立明确映射。
- 嵌套路由不要过深。
- 列表页、详情页、编辑页、设置页的组织方式应保持一致。

导航结构示例：

```text
Login -> Workspace Home
Dashboard -> Resources -> Resource Detail -> Related Items
Admin/System -> User / Role / Config Management
```

---

## 5. 认证、会话与权限协作

- 认证探针接口由 `docs/auth-baseline.md` 定义，本文档不固定具体路径。
- `401` 应跳转登录页，并可携带 `next` 参数。
- `403` 应展示无权限提示。
- `404` 应根据接口语义展示资源不存在或功能未启用。
- 应存在登录后的默认入口。
- 多角色用户的默认入口、手动切换角色和无可用角色处理方式，由 `docs/auth-baseline.md` 或具体业务文档定义。
- `frontend-architecture.md` 不定义具体角色集合。

---

## 6. 数据获取与缓存一致性

默认原则：

- 权限强相关、登录态强相关、当前操作强相关的数据默认 `no-store`。
- 低频变化的统计、概览、报表、配置、字典类数据可以使用 `revalidate` 或 tag 缓存。
- 写操作后根据影响范围执行 `revalidatePath` 或 `revalidateTag`。
- 禁止只刷新局部 UI 但保留过期主数据。

通用接口示例：

- `GET /api/resources`
- `GET /api/resources/:resourceId`
- `GET /api/resources/:resourceId/items`
- `GET /api/reports/summary`
- `GET /api/config/options`

tag 示例：

- `resource:{resourceId}:detail`
- `resource:{resourceId}:items`
- `report:summary:{window}`
- `config:options`

---

## 7. API Client 规范

推荐文件：

- `frontend/lib/api/errors.ts`
- `frontend/lib/api/client.ts`

设计原则：

- 默认走 BFF。
- 直连后端仅在部署和环境变量明确时使用。
- 统一处理 `json`、`text`、`204`、空响应。
- 统一错误分流。
- 不把服务端环境变量暴露到 client bundle。

`ApiError` 建议包含：

- `status`
- `code`
- `message`
- `details`

通用错误码示例：

- `VALIDATION_FAILED`
- `FORBIDDEN`
- `NOT_FOUND`
- `FEATURE_DISABLED`
- `INTERNAL_ERROR`

---

## 8. 组件分层与文件组织

推荐组织：

- `app/`：负责路由、`layout`、`page`、Route Handler
- `components/`：负责可复用 UI 组件
- `features/` 或 `modules/`：负责业务域组件与 hooks，是否采用由项目实际决定
- `lib/`：负责 API Client、工具、服务端辅助函数
- `types/`：负责共享前端类型
- `styles/`：负责全局样式

分层原则：

- `page.tsx` 应尽量薄。
- 复杂交互下沉到组件。
- 可复用逻辑下沉到 hooks 或 `lib/`。
- server-only 逻辑不得放入 Client Component。
- Client Component 不得直接读取服务端私有环境变量。
- Server Components 优先承载读取型页面和首屏数据获取。
- Client Components 仅承载交互、浏览器 API、局部状态、局部轮询、富文本、编辑器、图表等前端专属能力。

---

## 9. 错误处理与 UI 文案

处理原则：

- HTTP 状态与业务错误码应分层处理。
- 前端 UI 文案应面向用户友好表达。
- 后端 `code` 可用于分流，但不直接等同于最终 UI 文案。
- 不在本文档中定义具体业务错误文案全集。
- 具体业务文案可在业务文档、组件或 i18n 资源中定义。

基础分流建议：

- `401`：登录态失效，跳登录
- `403`：无权限
- `404`：资源不存在或功能未启用
- `409`：状态冲突，提示刷新或重试
- `422`：输入不合法，提示修正输入
- `500`：系统繁忙或服务异常

---

## 10. 环境变量与配置

原则：

- 仅 `NEXT_PUBLIC_` 前缀变量可进入 client bundle。
- 服务端私有变量只能在 server-only 代码中读取。
- BFF 代理后端地址应使用服务端环境变量。
- 不得在 Client Component 中读取服务端私有变量。

通用示例：

- `BACKEND_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_ENABLE_xxx`

说明：

- 上述变量名仅作为示例，不代表当前项目已经存在对应配置。

---

## 11. 前端架构演进与文档同步口径

涉及以下变化时，应同步更新本文档，或在任务的“〖文档同步要求〗”中明确说明：

- 前端目录结构
- 路由分区原则
- BFF 代理约定
- 认证协作方式
- API Client 约定
- 缓存刷新策略
- 全局状态管理方案
- 下载、导入导出处理方式
- 组件分层方式

以下情况通常不要求机械更新本文档：

- 普通页面新增
- 普通组件新增
- 局部 UI 调整

Codex 执行边界和文档同步执行规则以 `docs/codex-rules.md` 为准。

---

## 12. 与相关文档的职责关系

- `docs/codex-instruction-spec.md`：Codex 指令结构
- `docs/codex-rules.md`：Codex 执行规则、依赖治理、Git 安全、验证规则
- `docs/auth-baseline.md`：认证、会话、角色、权限
- `docs/backend-architecture.md`：后端架构、API 风格和后端分层
- `docs/e2e-testing.md`：E2E 测试组织和环境
- `docs/database-conventions.md`：数据库治理

如出现执行规则与前端架构说明的重叠或冲突，应以 `docs/codex-rules.md` 的执行规则为准；本文档聚焦前端工程架构本身。

