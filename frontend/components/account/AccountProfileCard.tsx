import { type AccountUser, getPrimaryAccountName, getRoleLabels } from "@/components/account/account-types";
import { toDisplayText } from "@/lib/ui/format";

type AccountProfileCardProps = {
  user: AccountUser;
};

const toRoleDisplay = (user: AccountUser): string => {
  const roles = getRoleLabels(user);
  return roles.length > 0 ? roles.join(" / ") : "—";
};

export function AccountProfileCard({ user }: AccountProfileCardProps) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold text-zinc-900">当前登录人信息</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs text-zinc-500">姓名</p>
          <p className="mt-1 text-sm text-zinc-900">{getPrimaryAccountName(user)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">邮箱</p>
          <p className="mt-1 text-sm text-zinc-900">{toDisplayText(user.email)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">角色</p>
          <p className="mt-1 text-sm text-zinc-900">{toRoleDisplay(user)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">账号状态</p>
          <p className="mt-1 text-sm text-zinc-900">{toDisplayText(user.status)}</p>
        </div>
        {typeof user.studentNo === "string" && user.studentNo.trim() ? (
          <div>
            <p className="text-xs text-zinc-500">学号</p>
            <p className="mt-1 text-sm text-zinc-900">{user.studentNo.trim()}</p>
          </div>
        ) : null}
        {typeof user.employeeNo === "string" && user.employeeNo.trim() ? (
          <div>
            <p className="text-xs text-zinc-500">工号</p>
            <p className="mt-1 text-sm text-zinc-900">{user.employeeNo.trim()}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
