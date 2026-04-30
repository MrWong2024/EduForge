"use client";

import { useState } from "react";
import { EmptyState } from "@/components/blocks/EmptyState";
import { TeacherFeedbackEditForm } from "@/components/teacher/TeacherFeedbackEditForm";
import {
  groupTeacherFeedbackItems,
  type TeacherFeedbackItem,
} from "@/lib/api/types-teacher";
import { toDisplayDate, toDisplayText } from "@/lib/ui/format";

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
    <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-900">
      {toDisplayText(item.message)}
    </p>
    <p className="mt-2 text-sm text-zinc-700">
      建议：{toDisplayText(item.suggestion)}
    </p>
    <p className="mt-1 text-sm text-zinc-700">
      标签：{item.tags.length > 0 ? item.tags.join(", ") : "—"}
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
  const groupedFeedback = groupTeacherFeedbackItems(items);
  const groupedSections = [
    { key: "teacher", title: "教师反馈", items: groupedFeedback.teacher },
    { key: "ai", title: "AI 反馈", items: groupedFeedback.ai },
    { key: "system", title: "系统反馈", items: groupedFeedback.system },
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
          className="rounded-lg border border-zinc-200 bg-white p-4"
        >
          <h3 className="text-sm font-semibold text-zinc-900">
            {section.title}
          </h3>
          {section.items.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">暂无该来源反馈。</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {section.items.map((item, index) => {
                const canEdit =
                  item.source?.toUpperCase() === "TEACHER" && !!item.id;
                const isEditing = !!item.id && editingFeedbackId === item.id;

                return (
                  <li
                    key={item.id ?? `${section.key}-${index}`}
                    className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-zinc-900 px-2 py-1 font-medium text-white">
                          {toDisplayText(item.source)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {toDisplayText(item.severity)}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                          {toDisplayText(item.type)}
                        </span>
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingFeedbackId(
                              isEditing ? null : (item.id ?? null),
                            )
                          }
                          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-white"
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
                        onCancel={() => setEditingFeedbackId(null)}
                        onSaved={() => setEditingFeedbackId(null)}
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
