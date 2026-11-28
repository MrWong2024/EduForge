"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { paths } from "@/lib/routes/paths";
import { isPageAccountMismatch, logoutFromPage } from "@/lib/api/browser-client";
import {
  PAGE_ACCOUNT_MISMATCH_MESSAGE,
  PAGE_ACCOUNT_UNAVAILABLE_MESSAGE,
  readPageAccountId,
} from "@/lib/api/page-account";

export function LogoutButton({ pageUserId }: { pageUserId?: string }) {
  const router = useRouter();
  const accountId = readPageAccountId(pageUserId);
  const pending = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<"mismatch" | "request" | null>(null);
  const failureMessages = {
    mismatch: PAGE_ACCOUNT_MISMATCH_MESSAGE,
    request: "注销失败，请重试。",
  };
  const errorMessage = !accountId
    ? PAGE_ACCOUNT_UNAVAILABLE_MESSAGE
    : failure && failureMessages[failure];
  const canLogout = Boolean(accountId) && failure !== "mismatch";

  const handleLogout = async () => {
    if (!canLogout || pending.current) return;
    pending.current = true;
    setIsSubmitting(true);
    setFailure(null);

    try {
      await logoutFromPage(accountId);
      router.push(paths.home);
      router.refresh();
    } catch (error) {
      setFailure(isPageAccountMismatch(error) ? "mismatch" : "request");
    } finally {
      pending.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleLogout}
        disabled={!canLogout || isSubmitting}
        className="shrink-0 whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "退出中..." : "退出登录"}
      </button>
      {errorMessage ? (
        <span role="alert" className="text-xs text-red-600">{errorMessage}</span>
      ) : null}
    </div>
  );
}
