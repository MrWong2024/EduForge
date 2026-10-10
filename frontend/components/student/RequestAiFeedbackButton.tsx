"use client";
type Props = {
  disabled: boolean;
  isSubmitting: boolean;
  onRequest: () => Promise<void>;
};
export function RequestAiFeedbackButton({
  disabled,
  isSubmitting,
  onRequest,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onRequest()}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
    >
      {isSubmitting ? "申请中…" : "申请 AI 辅助反馈"}
    </button>
  );
}
