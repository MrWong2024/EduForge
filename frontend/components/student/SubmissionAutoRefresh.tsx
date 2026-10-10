"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  getAutoRefreshPhase,
  type AiReview,
} from "@/lib/learning-tasks/ai-review";
type SubmissionAutoRefreshProps = { status?: string | null; review?: AiReview };
type PollableStatus = "PENDING" | "RUNNING" | "FAILED";

const getBaseDelayMs = (status: PollableStatus): number => {
  if (status === "FAILED") {
    return 15_000;
  }
  return 4_000;
};

const getDelayWithBackoff = (
  status: PollableStatus,
  unchangedRounds: number,
): number => {
  const base = getBaseDelayMs(status);
  const factor =
    unchangedRounds >= 12
      ? 3
      : unchangedRounds >= 6
        ? 2
        : unchangedRounds >= 3
          ? 1.5
          : 1;
  const cap = status === "FAILED" ? 45_000 : 15_000;
  return Math.min(Math.round(base * factor), cap);
};

export function SubmissionAutoRefresh({
  status,
  review,
}: SubmissionAutoRefreshProps) {
  const router = useRouter();
  const [isPageActive, setIsPageActive] = useState(true);
  const [isPending, startTransition] = useTransition();
  const pollableStatus = useMemo(
    () => getAutoRefreshPhase(status, review),
    [status, review],
  );
  const statusSignature =
    String(status ?? "") + "|" + String(review?.retryScheduled);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const unchangedRoundsRef = useRef(0);
  const lastStatusSignatureRef = useRef(statusSignature);

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

    if (!isPageActive || !pollableStatus) {
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
          scheduleNext(
            getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current),
          );
        }
      }, delay);
    };

    if (pollableStatus) {
      scheduleNext(
        getDelayWithBackoff(pollableStatus, unchangedRoundsRef.current),
      );
    }

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [clearTimer, isPageActive, pollableStatus, router, startTransition]);

  return null;
}
