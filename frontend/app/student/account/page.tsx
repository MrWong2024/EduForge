import type { Metadata } from "next";
import { AccountPageContent } from "@/components/account/AccountPageContent";
import { ErrorState } from "@/components/blocks/ErrorState";
import { FetchJsonError } from "@/lib/api/client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import { getMe } from "@/lib/auth/session";
import { paths } from "@/lib/routes/paths";
import { getCommonErrorSummary } from "@/lib/ui/status";

export const metadata: Metadata = {
  title: "账户设置",
};

type StudentAccountViewModel =
  | { mode: "ready"; me: Awaited<ReturnType<typeof getMe>> }
  | { mode: "error"; status: number; description: string };

export default async function StudentAccountPage() {
  let viewModel: StudentAccountViewModel = {
    mode: "error",
    status: 500,
    description: "加载账户信息失败，请稍后重试。",
  };

  try {
    const me = await getMe();
    viewModel = { mode: "ready", me };
  } catch (error) {
    if (error instanceof FetchJsonError) {
      const detail = extractRawDetail(error);
      viewModel = {
        mode: "error",
        status: error.status,
        description: buildErrorDescription(getCommonErrorSummary(error.status, "加载账户信息"), detail),
      };
    }
  }

  if (viewModel.mode === "error") {
    return (
      <ErrorState status={viewModel.status} title="账户信息加载失败" description={viewModel.description} />
    );
  }

  return (
    <AccountPageContent
      user={viewModel.me}
      backHref={paths.student.dashboard}
      backLabel="返回学习看板"
    />
  );
}
