"use client";

import { useState } from "react";
import { SubmissionAiReview } from "@/components/submissions/SubmissionAiReview";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";
import { TeacherFeedbackHistory } from "@/components/teacher/TeacherFeedbackHistory";
import type {
  SubmissionDetailResponse,
  TeacherFeedbackItem,
} from "@/lib/api/types-teacher";

export type TeacherSubmissionReviewContext = {
  viewerId: string;
  detail: SubmissionDetailResponse;
  feedback: TeacherFeedbackItem[];
};

type TeacherSubmissionReviewProps = {
  submissionId: string;
  context: TeacherSubmissionReviewContext | null;
};

export function TeacherSubmissionReview({
  submissionId,
  context,
}: TeacherSubmissionReviewProps) {
  const identity = context
    ? JSON.stringify([context.viewerId, context.detail.id])
    : null;
  const [lastConfirmedIdentity, setLastConfirmedIdentity] = useState(identity);
  if (identity !== null && identity !== lastConfirmedIdentity) {
    setLastConfirmedIdentity(identity);
  }
  const reviewKey = identity ?? lastConfirmedIdentity;
  if (reviewKey === null) return null;

  return (
    <TeacherSubmissionReviewContent
      key={reviewKey}
      submissionId={submissionId}
      context={context}
    />
  );
}

function TeacherSubmissionReviewContent({
  submissionId,
  context,
}: TeacherSubmissionReviewProps) {
  const detail = context?.detail;
  const suspended = context === null;

  return (
    <>
      <SubmissionAiReview
        submissionId={submissionId}
        contentRevision={detail?.contentRevision}
        status={detail?.aiFeedbackStatus}
        review={detail?.aiReview}
        autoRefresh={false}
        suspended={suspended}
      />
      {suspended ? null : (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          <p>
            此页用于查看作品与反馈，并新增或修改教师反馈。为保护未提交的批阅草稿，仅显式刷新；AI
            申请后点击刷新查看最新结果。
          </p>
        </section>
      )}
      <TeacherFeedbackForm
        submissionId={submissionId}
        contentRevision={detail?.contentRevision}
        suspended={suspended}
      />
      <TeacherFeedbackHistory
        items={context?.feedback ?? null}
        submissionId={submissionId}
      />
    </>
  );
}
