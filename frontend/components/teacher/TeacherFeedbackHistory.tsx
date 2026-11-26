"use client";

import { useRef, useState } from "react";
import { EmptyState } from "@/components/blocks/EmptyState";
import { TeacherFeedbackEditForm } from "@/components/teacher/TeacherFeedbackEditForm";
import {
  groupTeacherFeedbackItems,
  resolveTeacherFeedbackItem,
  type TeacherFeedbackItem,
} from "@/lib/api/types-teacher";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";
import {
  getFeedbackSourceLabel,
  getFeedbackTypeLabel,
  getFeedbackSeverityLabel,
} from "@/lib/ui/feedback-options";
import { getFeedbackTagLabel } from "@/lib/ui/feedback-tags";

type TeacherFeedbackHistoryProps = {
  items: TeacherFeedbackItem[];
  submissionId: string;
};

const hasUpdatedAtChanged = (item: TeacherFeedbackItem): boolean => {
  if (!item.updatedAt) {
    return false;
  }
  if (!item.createdAt) {
    return true;
  }
  return item.updatedAt !== item.createdAt;
};

const FeedbackReadonlyBody = ({ item }: { item: TeacherFeedbackItem }) => (
  <>
    <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-900">
      {item.source === "TEACHER" ? item.message || "—" : toDisplayText(item.message)}
    </p>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-700">
      建议：{item.source === "TEACHER" ? item.suggestion || "—" : toDisplayText(item.suggestion)}
    </p>
    <p className="mt-1 break-words text-sm text-zinc-700">
      标签：
      {item.tags.length > 0
        ? item.tags.map(getFeedbackTagLabel).join("，")
        : "—"}
    </p>
    <div className="mt-1 space-y-1 text-xs text-zinc-500">
      <p>创建于：{toDisplayDate(item.createdAt)}</p>
      {hasUpdatedAtChanged(item) ? (
        <p>更新于：{toDisplayDate(item.updatedAt)}</p>
      ) : null}
    </div>
  </>
);

export function TeacherFeedbackHistory({
  items,
  submissionId,
}: TeacherFeedbackHistoryProps) {
  const [editingFeedbackId, setEditingFeedbackId] = useState<string | null>(
    null,
  );
  const saveInFlight = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmedFeedback, setConfirmedFeedback] = useState(
    () => new Map<string, TeacherFeedbackItem>(),
  );
  const groupedFeedback = groupTeacherFeedbackItems(
    items.map((item) =>
      item.id ? resolveTeacherFeedbackItem(item, confirmedFeedback.get(item.id)) : item,
    ),
  );

  const changeEditingFeedback = (id: string | null) => {
    if (!saveInFlight.current) {
      setEditingFeedbackId(id);
    }
  };

  const startSaving = () => {
    if (saveInFlight.current) {
      return false;
    }
    saveInFlight.current = true;
    setIsSaving(true);
    return true;
  };

  const finishSaving = () => {
    saveInFlight.current = false;
    setIsSaving(false);
  };

  const handleSaved = (feedback: TeacherFeedbackItem) => {
    const id = feedback.id;
    if (!id || feedback.submissionId !== submissionId) {
      return;
    }
    setConfirmedFeedback((previous) => new Map(previous).set(id, feedback));
    setEditingFeedbackId((current) => (current === id ? null : current));
  };

  const groupedSections = [
    { key: "teacher", title: "教师反馈", items: groupedFeedback.teacher },
    { key: "ai", title: "AI 辅助反馈", items: groupedFeedback.ai },
    ...(groupedFeedback.other.length > 0
      ? [
          {
            key: "other",
            title: "其他反馈（来源未识别）",
            items: groupedFeedback.other,
          },
        ]
      : []),
  ] as const;

  if (items.length === 0) {
    return (
      <EmptyState title="暂无反馈记录" description="可先在上方填写教师反馈。" />
    );
  }

  return (
    <>
      {groupedSections.map((section) => (
        <section
          key={section.key}
          className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <h3 className="text-sm font-semibold text-zinc-900">
            {section.title}
          </h3>
          {section.items.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">暂无该来源反馈。</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {section.items.map((item, index) => {
                const canEdit = item.source === "TEACHER" && !!item.id;
                const isEditing = canEdit && editingFeedbackId === item.id;

                return (
                  <li
                    key={item.id ?? `${section.key}-${index}`}
                    className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-zinc-900 px-2 py-1 font-medium text-white">
                          {getFeedbackSourceLabel(item.source)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {getFeedbackSeverityLabel(item.severity)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {getFeedbackTypeLabel(item.type)}
                        </span>
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            changeEditingFeedback(
                              isEditing ? null : (item.id ?? null),
                            )
                          }
                          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 enabled:hover:bg-white disabled:cursor-not-allowed disabled:text-zinc-400"
                        >
                          {isEditing ? "收起修改" : "修改"}
                        </button>
                      ) : null}
                    </div>

                    <FeedbackReadonlyBody item={item} />

                    {isEditing ? (
                      <TeacherFeedbackEditForm
                        feedback={item}
                        submissionId={submissionId}
                        isSaving={isSaving}
                        onCancel={() => changeEditingFeedback(null)}
                        onSaveStart={startSaving}
                        onSaveFinish={finishSaving}
                        onSaved={handleSaved}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
