import Link from "next/link";
import type { ReactNode } from "react";
import type { MyTaskDetailResponse } from "@/lib/api/types-student";
import { getFeedbackSeverityLabel, getFeedbackTypeLabel } from "@/lib/ui/feedback-options";
import { getFeedbackTagLabel } from "@/lib/ui/feedback-tags";
import { safeGet, toDisplayDate, toDisplayText } from "@/lib/ui/format";

type AiFeedbackPreviewItem = {
  source: "AI";
  type?: unknown;
  severity?: unknown;
  message: string;
  suggestion?: unknown;
  tags?: unknown;
};

function isAiFeedbackPreviewItem(value: unknown): value is AiFeedbackPreviewItem {
  return safeGet<unknown>(value, "source", null) === "AI" &&
    typeof safeGet<unknown>(value, "message", null) === "string";
}

type TaskSubmissionHistoryEntryProps = {
  submission: MyTaskDetailResponse["submissions"][number];
  aiStatus: ReactNode;
  feedbackHref: string | null;
  includeFeedbackItems: boolean;
};

export function TaskSubmissionHistoryEntry({
  submission,
  aiStatus,
  feedbackHref,
  includeFeedbackItems,
}: TaskSubmissionHistoryEntryProps) {
  const { attemptNo, createdAt, feedbackItems } = submission;
  const items = includeFeedbackItems && Array.isArray(feedbackItems)
    ? feedbackItems.filter(isAiFeedbackPreviewItem)
    : [];

  return (
    <tbody>
      <tr className="border-t border-zinc-100">
        <td className="px-4 py-3">{toDisplayText(attemptNo)}</td>
        <td className="px-4 py-3">
          {toDisplayDate(typeof createdAt === "string" ? createdAt : null)}
        </td>
        <td className="px-4 py-3">{aiStatus}</td>
        <td className="px-4 py-3">
          {feedbackHref ? (
            <Link href={feedbackHref} className="text-blue-700 hover:underline">
              查看反馈
            </Link>
          ) : (
            <span className="text-zinc-500">缺少提交标识</span>
          )}
        </td>
      </tr>
      {includeFeedbackItems ? (
        <tr>
          <td colSpan={4} className="bg-zinc-50 px-4 pb-4 pt-3 [overflow-wrap:anywhere]">
            <h3 className="font-medium text-zinc-900">
              {typeof attemptNo === "number" ? `第 ${attemptNo} 次提交` : "本次提交"}的 AI 反馈预览
            </h3>
            {items.length === 0 ? (
              <p className="mt-2 text-zinc-600">本次暂无 AI 反馈预览</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {items.map(({ type, severity, message, suggestion, tags }, index) => {
                  const visibleTags = Array.isArray(tags)
                    ? tags.filter((tag: unknown) => typeof tag === "string" && tag.trim())
                    : [];
                  return (
                    <li key={index} className="space-y-1 rounded-md border border-zinc-200 bg-white p-3">
                      <p className="text-xs text-zinc-600">
                        {getFeedbackTypeLabel(type)} · {getFeedbackSeverityLabel(severity)}
                      </p>
                      <p className="whitespace-pre-wrap text-zinc-900">{message}</p>
                      {typeof suggestion === "string" && suggestion.trim() ? (
                        <p className="whitespace-pre-wrap text-zinc-700">建议：{suggestion}</p>
                      ) : null}
                      {visibleTags.length > 0 ? (
                        <p className="text-xs text-zinc-600">
                          标签：{visibleTags.map(getFeedbackTagLabel).join("、")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
