"use client";
import { useRouter } from "next/navigation";
export function RefreshButton({ label = "刷新" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="text-sm text-blue-700 underline"
    >
      {label}
    </button>
  );
}
