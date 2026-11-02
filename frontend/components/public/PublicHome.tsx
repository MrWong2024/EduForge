import Link from "next/link";
import { OrbitPassCase } from "@/components/public/OrbitPassCase";
import { paths } from "@/lib/routes/paths";

export function PublicHome() {
  return (
    <div id="top" className="min-h-dvh bg-white text-zinc-900">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-white px-4 py-3 text-blue-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-offset-4 focus:outline-blue-600"
      >
        跳到主要内容
      </a>

      <header className="border-b border-zinc-100 bg-white">
        <nav
          aria-label="首页导航"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12"
        >
          <Link
            href={paths.home}
            className="flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-lg font-bold text-blue-700"
            >
              E
            </span>
            <span className="text-lg font-semibold tracking-tight sm:text-xl">
              EduForge · 智炼
            </span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a
              href="#orbitpass-case"
              className="hidden rounded-sm text-zinc-600 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 md:inline"
            >
              协作案例
            </a>
            <a
              href="#teaching-value"
              className="hidden rounded-sm text-zinc-600 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 md:inline"
            >
              教学价值
            </a>
            <Link
              href={paths.login}
              prefetch={false}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 font-medium text-zinc-700 hover:border-blue-300 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
            >
              登录平台
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section aria-labelledby="home-title" className="relative isolate">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-gradient-to-br from-sky-50/80 via-white to-indigo-50/70"
          >
            <div className="absolute -right-20 top-8 h-72 w-72 rounded-full bg-indigo-100/60 blur-3xl" />
            <div className="absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-sky-100/60 blur-3xl" />
          </div>
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:px-12 lg:py-24">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-blue-700">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                />
                面向 AI 协作编程的教学平台
              </p>
              <h1
                id="home-title"
                className="mt-5 max-w-2xl text-[2rem] font-semibold leading-[1.3] tracking-tight text-zinc-900 sm:text-5xl lg:text-[2.6rem] xl:text-[3.35rem]"
              >
                让学生知道怎样改，
                <span className="block text-blue-700">
                  让教师看见学习过程。
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-zinc-600 sm:text-lg">
                从编程任务出发，提交作品与独立说明，在 AI
                辅助反馈和教师评阅中持续修订，为教学复盘留下可回看的过程。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#orbitpass-case"
                  className="inline-flex items-center gap-3 rounded-md bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
                >
                  查看协作案例 <span aria-hidden="true">→</span>
                </a>
                <Link
                  href={paths.login}
                  prefetch={false}
                  className="inline-flex rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-medium text-zinc-700 hover:border-blue-300 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
                >
                  登录平台
                </Link>
              </div>
              <p className="mt-7 max-w-xl border-l-2 border-blue-200 pl-4 text-sm leading-6 text-zinc-500">
                AI 给出建议，人作出判断。
                <br />
                关注作品怎样形成，也关注学生为什么这样修改。
              </p>
            </div>

            <aside
              aria-label="OrbitPass 协作案例预览"
              className="min-w-0 rounded-2xl border border-zinc-200 bg-white shadow-[0_16px_56px_-28px_rgba(30,64,175,0.35)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-4">
                <span className="text-sm font-semibold text-zinc-700">
                  OrbitPass / 协作片段
                </span>
                <span className="text-xs text-zinc-500">预置材料预览</span>
              </div>
              <div className="p-5 sm:p-6">
                <p className="text-xs font-medium tracking-wide text-indigo-700">
                  人定义规则 → AI 提交初稿 → 人审查
                </p>
                <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
                  一个席位，不能分给两个人。
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  需求看似简单，真正的判断发生在重试、并发与失败之间。
                </p>
                <div className="mt-5 min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                  <p className="border-b border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-600">
                    AI 初稿节选 · 存在竞争窗口
                  </p>
                  <pre
                    tabIndex={0}
                    aria-label="存在竞争窗口的初稿示意代码"
                    className="max-w-full overflow-x-auto p-4 font-mono text-xs leading-7 text-zinc-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 sm:text-sm"
                  >
                    <code>{`const seats = await readRemaining(eventId);
if (seats > 0) {
  await decreaseSeat(eventId);
  await createReservation(userId, eventId);
}`}</code>
                  </pre>
                </div>
                <div className="mt-4 border-l-2 border-amber-400 bg-amber-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-800">
                    人的审查意见
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700">
                    两个请求可能同时读到最后一个名额。先检查余量，仍然可能超额。
                  </p>
                </div>
                <a
                  href="#orbitpass-case"
                  className="mt-5 inline-flex items-center gap-2 rounded-sm text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
                >
                  看修订思路与验证依据 <span aria-hidden="true">↓</span>
                </a>
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  虚构工程案例 · 预置演示材料。代码仅用于说明问题。
                </p>
              </div>
            </aside>
          </div>
        </section>

        <OrbitPassCase />

        <section
          id="teaching-value"
          aria-labelledby="teaching-value-title"
          className="scroll-mt-8 border-t border-zinc-100 bg-white"
        >
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
            <p className="text-sm font-medium text-blue-700">回到教学本身</p>
            <h2
              id="teaching-value-title"
              className="mt-3 max-w-3xl text-2xl font-semibold leading-snug tracking-tight text-zinc-900 sm:text-3xl"
            >
              把作品的完成，变成可以讨论的学习过程。
            </h2>
            <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-12">
              <article className="min-w-0">
                <p className="text-sm font-medium text-indigo-700">学生视角</p>
                <h3 className="mt-2 text-xl font-semibold text-zinc-900">
                  交出作品，也说清自己的判断。
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-600">
                  围绕任务要求完成提交，用独立说明解释 AI
                  参与了什么、自己审查了什么，以及为什么接受当前方案。
                </p>
                <ul className="mt-5 space-y-3 border-l border-zinc-200 pl-5 text-sm leading-6 text-zinc-700">
                  <li>对照任务描述与评阅标准，明确作品需要回答的问题。</li>
                  <li>结合 AI 辅助反馈和教师意见，找到下一次修改的依据。</li>
                  <li>回看提交与反馈，说明已经改进的部分和仍待解决的边界。</li>
                </ul>
              </article>
              <article className="min-w-0 border-t border-zinc-200 pt-8 md:border-l md:border-t-0 md:pl-12 md:pt-0">
                <p className="text-sm font-medium text-blue-700">教师视角</p>
                <h3 className="mt-2 text-xl font-semibold text-zinc-900">
                  看到提交，也找到下一步教学的线索。
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-600">
                  从任务与作品出发，结合学生独立说明、AI
                  辅助反馈和教师评阅，理解修改过程，把追问落到具体问题上。
                </p>
                <ul className="mt-5 space-y-3 border-l border-zinc-200 pl-5 text-sm leading-6 text-zinc-700">
                  <li>以明确的教学要求组织任务、评阅与反馈。</li>
                  <li>区分 AI 建议与教师判断，围绕证据给出改进方向。</li>
                  <li>
                    结合提交与反馈记录开展教学复盘，不把测试通过等同于能力结论。
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="account-title"
          className="border-t border-zinc-200 bg-zinc-50"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.2fr_0.8fr] lg:px-12">
            <div className="min-w-0">
              <p className="text-sm font-medium text-blue-700">账号与入口</p>
              <h2
                id="account-title"
                className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl"
              >
                进入你的教学空间。
              </h2>
              <dl className="mt-6 space-y-4 text-sm leading-6">
                <div className="flex gap-5">
                  <dt className="shrink-0 font-medium text-zinc-900">学生</dt>
                  <dd className="text-zinc-600">请向任课教师了解账号安排。</dd>
                </div>
                <div className="flex gap-5">
                  <dt className="shrink-0 font-medium text-zinc-900">教师</dt>
                  <dd className="text-zinc-600">
                    请向平台管理员了解开通方式。
                  </dd>
                </div>
              </dl>
            </div>
            <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-6 sm:p-7">
              <h3 className="text-base font-semibold text-zinc-900">
                已有账号，继续课堂任务与反馈。
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                登录后，按账号角色进入相应的教学空间。
              </p>
              <Link
                href={paths.login}
                prefetch={false}
                className="mt-5 inline-flex items-center gap-3 rounded-md bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
              >
                登录平台 <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-xs leading-6 text-zinc-500 sm:px-8 lg:px-12">
          <p>
            <span className="font-medium text-zinc-700">EduForge · 智炼</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            重庆邮电大学
          </p>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
          >
            渝ICP备2026008292号-1
          </a>
        </div>
      </footer>
    </div>
  );
}
