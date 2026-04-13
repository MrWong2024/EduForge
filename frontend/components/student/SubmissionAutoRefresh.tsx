"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SubmissionAutoRefreshProps = {
  status?: string | null | undefined;
  statuses?: Array<string | null | undefined>;
};

type PollableStatus = "PENDING" | "RUNNING" | "FAILED";

const normalizeStatus = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const resolvePollableStatus = (statuses: string[]): PollableStatus | null => {
  if (statuses.includes("RUNNING")) {
    return "RUNNING";
  }
  if (statuses.includes("PENDING")) {
    return "PENDING";
  }
  if (statuses.includes("FAILED")) {
    return "FAILED";
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

export function SubmissionAutoRefresh({ status, statuses }: SubmissionAutoRefreshProps) {
  const router = useRouter();
  const [isPageActive, setIsPageActive] = useState(true);
  const [isPending, startTransition] = useTransition();
  const normalizedStatuses = useMemo(() => {
    if (statuses && statuses.length > 0) {
      return statuses
        .map((item) => normalizeStatus(item))
        .filter((item): item is string => Boolean(item));
    }
    const normalizedStatus = normalizeStatus(status);
    return normalizedStatus ? [normalizedStatus] : [];
  }, [status, statuses]);
  const pollableStatus = useMemo(
    () => resolvePollableStatus(normalizedStatuses),
    [normalizedStatuses]
  );
  const statusSignature = useMemo(
    () => normalizedStatuses.join("|"),
    [normalizedStatuses]
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const unchangedRoundsRef = useRef(0);
  const lastStatusSignatureRef = useRef(statusSignature);
  const tailRefreshRemainingRef = useRef(0);

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
    if (lastStatusSignatureRef.current !== statusSignature) {
      lastStatusSignatureRef.current = statusSignature;
      unchangedRoundsRef.current = 0;
    }
  }, [statusSignature]);

  useEffect(() => {
    if (pollableStatus) {
      tailRefreshRemainingRef.current = 1;
    }
  }, [pollableStatus]);

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

    if (!isPageActive) {
      return () => clearTimer();
    }

    let cancelled = false;

    const scheduleNext = (delay: number) => {
      if (cancelled) {
        return;
      }

      timerRef.current = setTimeout(() => {
        if (cancelled) {
          return;
        }

        if (inFlightRef.current || pendingRef.current) {
          const nextDelay = pollableStatus
            ? getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current)
            : 1_500;
          scheduleNext(nextDelay);
          return;
        }

        inFlightRef.current = true;
        unchangedRoundsRef.current += 1;
        startTransition(() => {
          router.refresh();
        });

        if (pollableStatus) {
          scheduleNext(getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current));
        }
      }, delay);
    };

    if (pollableStatus) {
      scheduleNext(getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current));
    } else if (tailRefreshRemainingRef.current > 0) {
      tailRefreshRemainingRef.current -= 1;
      scheduleNext(1_500);
    }

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [clearTimer, isPageActive, pollableStatus, router, startTransition]);

  return null;
}
