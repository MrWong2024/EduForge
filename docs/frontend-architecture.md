# 前端架构规范（Next.js）

本文档定义 `frontend\` 前端工程的目录结构、路由组织、数据获取、后端访问、可选 BFF、组件分层、错误处理、缓存刷新和架构演进口径。
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

- 后端访问拓扑必须由项目级部署、认证、安全和复杂度合同确定；不得在缺少现实需求时机械增加 BFF，也不得在必须保护服务端私有凭据等条件下强行采用浏览器直连。
- 前端不得在 client bundle 暴露服务端敏感环境变量。
- Server Components、Server Actions、Route Handler 与 Client Components 的职责必须清晰。
- 认证和权限口径以 `docs/auth-baseline.md` 为准。
- 后端错误 `code`、`message` 原则上不直接作为最终中文 UI 文案；前端 UI 层可做友好提示映射。
- 当后端以 `404` 隐藏未启用功能或受限能力时，前端应根据业务错误码或接口契约展示“功能未启用”或“资源不存在”等友好提示。

---

## 3. 后端访问拓扑与 BFF 选择

### 3.1 条件式拓扑选择

后端访问拓扑可以根据现实需求选择：

- Browser 直接访问公开 backend API；
- 由部署层提供同源反向代理；
- 通过 BFF、Route Handler 或其他受控服务端代理访问 backend。

三者没有一项是所有项目的机械默认答案。选择时必须同时核对认证与 Cookie 拓扑、CORS / SameSite / Domain、server-only Secret、服务端聚合或转换、同源要求、文件上传 / 下载与流式响应、部署结构，以及实现、测试和运维复杂度。

多个方案都满足安全和业务合同时，采用最低充分复杂度的方案；现有方式已经满足合同时，不为架构形式增加、删除或迁移中间层。

### 3.2 BFF 的可选引入条件

BFF 是条件式架构能力，不是信仰或固定模板。只有存在明确现实需求时才引入或保留，例如：

- 必须隐藏只能由服务端持有的私有凭据；
- 必须执行服务端聚合、转换或受控编排；
- 部署合同明确要求同源代理；
- 现有部署、安全或认证合同无法由浏览器直连满足。

不能仅因为“BFF 更规范”增加 BFF，也不能仅因为“直连少一层”删除确有现实用途的 BFF。确需代理时，代理必须保持 HTTP 方法，不擅自改写请求体，按合同透传认证所需 Cookie、`Content-Type`、必要请求头和必要响应头，并保留错误状态码和必要响应体；二进制或流式响应不得强行按 JSON 解析。

### 3.3 RSC、下载与导入导出

- Server Components 运行在服务端环境中，不得用相对 `/api/...` 假定请求会自动命中 backend；如需服务端请求，应使用项目级配置明确的服务端可访问 API 地址或项目已锁定的代理路径。
- 文件上传、下载、导入导出及流式响应应按项目已选拓扑处理。经过代理时，必须透传适用的 `Content-Type`、`Content-Disposition`、状态码和流式语义。
- 前端应根据文件名、MIME type 和响应头处理下载行为。

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

- API Client 的 base URL 或 proxy path 由项目配置与项目级 handoff 明确，Client 不自行决定项目网络拓扑。
- `credentials`、Cookie 和认证请求选项按项目已锁定的认证与部署拓扑统一处理。
- Browser direct、反向代理或 BFF 均不得被 API Client 代码机械假定为所有项目的固定答案。
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
- 浏览器可读变量不得包含服务端 Secret；BFF 或其他服务端代理的私有地址与凭据必须使用 server-only 环境变量。
- 不得在 Client Component 中读取服务端私有变量。

通用示例：

- `NEXT_PUBLIC_API_BASE_URL`：Browser 直连公开 API 时可能采用的公开变量名示例。
- `BACKEND_API_BASE_URL`：服务端代理访问 backend 时可能采用的 server-only 变量名示例。

上述名称仅用于说明作用域，不代表任何项目必须存在这些变量，也不构成当前配置清单。具体名称和值由项目配置与项目级 handoff 维护。

---

## 11. 前端架构演进与文档同步口径

通用前端架构原则本身发生变化时，应同步更新本文档，或在任务的“〖文档同步要求〗”中明确说明，例如：

- 前端目录结构
- 路由分区原则
- 后端访问拓扑的通用选择条件
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
- 某个具体项目在 Browser direct、反向代理或 BFF 之间作出选择或切换
- 某个具体项目的 base URL、环境变量名、proxy path 或部署值变化

上述项目专属事实优先同步项目级 handoff、代码或配置；只有变化同时改变跨项目通用架构原则时，才更新本文档。

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
