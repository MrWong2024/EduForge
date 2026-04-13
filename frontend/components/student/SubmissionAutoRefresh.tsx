"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SubmissionAutoRefreshProps = {
  status: string | null | undefined;
};

type PollableStatus = "PENDING" | "RUNNING" | "FAILED";

const normalizeStatus = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const toPollableStatus = (value: string | null): PollableStatus | null => {
  if (value === "PENDING" || value === "RUNNING" || value === "FAILED") {
    return value;
  }
  return null;
};

const getBaseDelayMs = (status: PollableStatus): number => {
  if (status === "FAILED") {
    return 15_000;
  }
  return 4_000;
};

const getDelayWithBackoff = (status: PollableStatus, unchangedRounds: number): number => {
  const base = getBaseDelayMs(status);
  const factor =
    unchangedRounds >= 12 ? 3 : unchangedRounds >= 6 ? 2 : unchangedRounds >= 3 ? 1.5 : 1;
  const cap = status === "FAILED" ? 45_000 : 15_000;
  return Math.min(Math.round(base * factor), cap);
};

export function SubmissionAutoRefresh({ status }: SubmissionAutoRefreshProps) {
  const router = useRouter();
  const [isPageActive, setIsPageActive] = useState(true);
  const [isPending, startTransition] = useTransition();
  const normalizedStatus = useMemo(() => normalizeStatus(status), [status]);
  const pollableStatus = useMemo(
    () => toPollableStatus(normalizedStatus),
    [normalizedStatus]
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const unchangedRoundsRef = useRef(0);
  const lastStatusRef = useRef<string | null>(normalizedStatus);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    pendingRef.current = isPending;
    if (!isPending) {
      inFlightRef.current = false;
    }
  }, [isPending]);

  useEffect(() => {
    if (lastStatusRef.current !== normalizedStatus) {
      lastStatusRef.current = normalizedStatus;
      unchangedRoundsRef.current = 0;
    }
  }, [normalizedStatus]);

  useEffect(() => {
    const resolveIsPageActive = (): boolean =>
      document.visibilityState === "visible" && document.hasFocus();

    const syncPageActivity = () => {
      setIsPageActive(resolveIsPageActive());
    };

    syncPageActivity();
    document.addEventListener("visibilitychange", syncPageActivity);
    window.addEventListener("focus", syncPageActivity);
    window.addEventListener("blur", syncPageActivity);

    return () => {
      document.removeEventListener("visibilitychange", syncPageActivity);
      window.removeEventListener("focus", syncPageActivity);
      window.removeEventListener("blur", syncPageActivity);
    };
  }, []);

  useEffect(() => {
    clearTimer();

    if (!pollableStatus || !isPageActive) {
      return () => clearTimer();
    }

    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }

      const delay = getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current);
      timerRef.current = setTimeout(() => {
        if (cancelled) {
          return;
        }

        if (inFlightRef.current || pendingRef.current) {
          scheduleNext();
          return;
        }

        inFlightRef.current = true;
        unchangedRoundsRef.current += 1;
        startTransition(() => {
          router.refresh();
        });

        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [clearTimer, isPageActive, pollableStatus, router, startTransition]);

  return null;
}

