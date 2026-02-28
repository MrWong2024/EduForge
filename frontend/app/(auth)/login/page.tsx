import Link from "next/link";
import { PageHeader } from "@/components/blocks/PageHeader";
import { EmptyState } from "@/components/blocks/EmptyState";
import { paths } from "@/lib/routes/paths";

export default function LoginPage() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <PageHeader title="登录" description="会话登录入口（占位）" />
      <EmptyState
        title="登录表单待接入"
        description="TODO: 接入 POST /api/auth/login，并根据 /api/users/me 角色跳转。"
      />
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link className="text-blue-700 hover:underline" href={paths.teacher.classrooms}>
          教师端入口
        </Link>
        <Link className="text-blue-700 hover:underline" href={paths.student.dashboard}>
          学生端入口
        </Link>
      </div>
    </section>
  );
}
