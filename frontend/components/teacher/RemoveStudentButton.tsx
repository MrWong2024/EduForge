"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/blocks/ConfirmDialog";
import { ErrorState } from "@/components/blocks/ErrorState";
import { BrowserFetchJsonError, fetchJson } from "@/lib/api/browser-client";
import { buildErrorDescription, extractRawDetail } from "@/lib/api/error-presenter";
import {
  updateMemberRemovalFeedback,
  type MemberRemovalFeedback,
} from "@/lib/classroom-member-removal";
import { getCommonErrorSummary } from "@/lib/ui/status";

type RemoveStudentButtonProps = {
  classroomId: string;
  studentUserId: string;
  studentName: string;
  disabled?: boolean;
};

const RemovalFeedbackContext = createContext<
  ((
    studentUserId: string,
    feedback: MemberRemovalFeedback | null,
    moveFocus?: boolean,
  ) => void) | null
>(null);

export function ClassroomMemberRemovalFeedback({
  children,
  summary,
  validPageHref,
}: {
  children: ReactNode;
  summary: ReactNode;
  validPageHref?: string;
}) {
  const router = useRouter();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<
    ReadonlyMap<string, MemberRemovalFeedback>
  >(() => new Map());

  useEffect(() => {
    if (validPageHref) router.replace(validPageHref, { scroll: false });
  }, [router, validPageHref]);

  const reportFeedback = useCallback(
    (
      studentUserId: string,
      result: MemberRemovalFeedback | null,
      moveFocus = false,
    ) => {
      setFeedback((current) =>
        updateMemberRemovalFeedback(current, studentUserId, result),
      );
      if (moveFocus) summaryRef.current?.focus();
    },
    [],
  );

  return (
    <RemovalFeedbackContext.Provider value={reportFeedback}>
      <div className="space-y-4">
        <div ref={summaryRef} tabIndex={-1} className="text-sm text-zinc-600">
          <p role={validPageHref ? "status" : undefined}>
            {validPageHref ? "正在加载班级成员列表…" : summary}
          </p>
          {Array.from(feedback, ([studentUserId, result]) =>
            result.kind === "success" ? (
              <p key={studentUserId} role="status" className="mt-2 text-emerald-700">
                {result.message}
              </p>
            ) : (
              <div key={studentUserId} role="alert" className="mt-2">
                <ErrorState
                  status={result.status}
                  title={`移除成员失败：${result.studentName}`}
                  description={buildErrorDescription(result.summary, result.detail)}
                />
              </div>
            ),
          )}
        </div>
        {validPageHref ? null : children}
      </div>
    </RemovalFeedbackContext.Provider>
  );
}

export function RemoveStudentButton({
  classroomId,
  studentUserId,
  studentName,
  disabled = false,
}: RemoveStudentButtonProps) {
  const router = useRouter();
  const reportFeedback = useContext(RemovalFeedbackContext);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const submittingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isBusy = isSubmitting || isRefreshing;

  if (!reportFeedback) {
    throw new Error("RemoveStudentButton requires a classroom member feedback area.");
  }

  const handleRemove = async () => {
    if (disabled || !isConfirming || isBusy || submittingRef.current) return;

    submittingRef.current = true;
    setIsConfirming(false);
    setIsSubmitting(true);
    reportFeedback(studentUserId, null);

    try {
      await fetchJson<unknown>(
        `classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(studentUserId)}/remove`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
          },
        }
      );
      const rowHasFocus = triggerRef.current?.closest("tr")?.contains(document.activeElement);
      reportFeedback(
        studentUserId,
        { kind: "success", message: `已将${studentName}移出班级。历史记录已保留。` },
        rowHasFocus,
      );
      startRefresh(() => router.refresh());
    } catch (error) {
      if (error instanceof BrowserFetchJsonError) {
        const detail = extractRawDetail(error.data);
        const summary =
          error.status === 403
            ? "无权限管理该班级成员。"
            : getCommonErrorSummary(error.status, "移除成员");
        reportFeedback(studentUserId, {
          kind: "error",
          studentName,
          status: error.status,
          summary,
          detail,
        });
      } else {
        reportFeedback(studentUserId, {
          kind: "error",
          studentName,
          summary: "移除成员失败，请稍后重试。",
        });
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          if (disabled || isBusy || isConfirming || submittingRef.current) return;
          event.currentTarget.focus();
          setIsConfirming(true);
        }}
        disabled={disabled}
        aria-disabled={disabled || isBusy}
        aria-haspopup="dialog"
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-400"
      >
        {isSubmitting ? "移除中..." : "移除"}
      </button>

      {isConfirming ? (
        <ConfirmDialog
          title={`移出成员：${studentName}`}
          description="移出后，该成员将从当前班级名单中移除。已有提交等历史记录会保留。"
          confirmLabel="移出成员"
          destructive
          onCancel={() => setIsConfirming(false)}
          onConfirm={handleRemove}
        />
      ) : null}
    </div>
  );
}
