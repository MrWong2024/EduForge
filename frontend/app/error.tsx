"use client";

import { ErrorState } from "@/components/blocks/ErrorState";

type AppErrorPageProps = {
  error: Error;
  reset: () => void;
};

export default function AppErrorPage({ error, reset }: AppErrorPageProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <ErrorState title="Page Error" description={error.message || "Unknown error occurred."} />
      <button
        type="button"
        className="mt-4 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
        onClick={reset}
      >
        Retry
      </button>
    </main>
  );
}
