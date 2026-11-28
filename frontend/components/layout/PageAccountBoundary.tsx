"use client";

import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PageAccountScope } from "@/lib/api/browser-client";
import {
  PAGE_ACCOUNT_MISMATCH_MESSAGE,
  PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE,
  PAGE_ACCOUNT_UNAVAILABLE_MESSAGE,
  readPageAccountId,
} from "@/lib/api/page-account";
import { PageAccountContext } from "@/lib/api/use-page-fetch";

function ReopenPage({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950"
    >
      <p>{message}</p>
      <button
        type="button"
        className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5"
        onClick={() => window.location.reload()}
      >
        重新打开页面
      </button>
    </section>
  );
}

function VerifiedPageAccount({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const active = useRef<symbol | null>(null);
  const waitingForConfirmation = useRef(false);
  const [mismatch, setMismatch] = useState(false);
  const [unconfirmedSuccess, setUnconfirmedSuccess] = useState(false);
  useLayoutEffect(() => {
    active.current = Symbol();
    return () => {
      active.current = null;
    };
  }, []);
  const scope = useMemo<PageAccountScope>(
    () => ({
      expectedUserId: accountId,
      capture() {
        const lifetime = active.current;
        return () => lifetime !== null && active.current === lifetime;
      },
      canWrite: () => !waitingForConfirmation.current,
      onMismatch() {
        active.current = null;
        setMismatch(true);
      },
      onUnconfirmedSuccess() {
        waitingForConfirmation.current = true;
        setUnconfirmedSuccess(true);
      },
    }),
    [accountId],
  );

  if (mismatch) return <ReopenPage message={PAGE_ACCOUNT_MISMATCH_MESSAGE} />;
  return (
    <PageAccountContext.Provider value={scope}>
      {unconfirmedSuccess ? (
        <ReopenPage message={PAGE_ACCOUNT_UNCONFIRMED_SUCCESS_MESSAGE} />
      ) : null}
      {children}
    </PageAccountContext.Provider>
  );
}

export function PageAccountBoundary({
  userId,
  children,
}: {
  userId: unknown;
  children: ReactNode;
}) {
  const accountId = readPageAccountId(userId);
  if (!accountId) return <ReopenPage message={PAGE_ACCOUNT_UNAVAILABLE_MESSAGE} />;
  return (
    <VerifiedPageAccount key={accountId} accountId={accountId}>
      {children}
    </VerifiedPageAccount>
  );
}
