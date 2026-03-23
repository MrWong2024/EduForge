import Link from "next/link";
import { AccountProfileCard } from "@/components/account/AccountProfileCard";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { type AccountUser } from "@/components/account/account-types";
import { PageHeader } from "@/components/blocks/PageHeader";

type AccountPageContentProps = {
  user: AccountUser;
  backHref: string;
  backLabel: string;
};

export function AccountPageContent({ user, backHref, backLabel }: AccountPageContentProps) {
  return (
    <section className="space-y-4">
      <PageHeader
        title="账户设置"
        description="查看当前登录人信息并修改密码。"
        actions={
          <Link href={backHref} className="text-sm text-blue-700 hover:underline">
            {backLabel}
          </Link>
        }
      />

      <AccountProfileCard user={user} />
      <ChangePasswordForm />
    </section>
  );
}
