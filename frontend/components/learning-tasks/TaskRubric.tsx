import { getRubricNotes } from "@/lib/learning-tasks/rubric";

export function TaskRubric({ rubric }: { rubric: unknown }) {
  const notes = getRubricNotes(rubric);
  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-zinc-900">评阅标准</h2>
      {notes.trim() ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-zinc-700 [overflow-wrap:anywhere]">
          {notes}
        </p>
      ) : (
        <p className="mt-3 text-zinc-600">
          未填写评阅标准，AI 将依据任务描述评阅。
        </p>
      )}
    </section>
  );
}
