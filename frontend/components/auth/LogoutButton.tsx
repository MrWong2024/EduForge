"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { paths } from "@/lib/routes/paths";
import { buildProxyPath } from "@/lib/api/browser-client";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogout = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(buildProxyPath("auth/logout"), {
        method: "POST",
        headers: {
          accept: "application/json",
        },
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      router.push(paths.login);
      router.refresh();
    } catch {
      setErrorMessage("注销失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleLogout}
        disabled={isSubmitting}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "退出中..." : "退出登录"}
      </button>
      {errorMessage ? <span className="text-xs text-red-600">{errorMessage}</span> : null}
    </div>
  );
}
