import { getRubricDimensionLabel } from "@/lib/ui/rubric";
import { toDisplayText } from "@/lib/ui/format";
export function TaskRubric({ rubric }: { rubric: unknown }) {
  const record =
    rubric && typeof rubric === "object" && !Array.isArray(rubric)
      ? (rubric as Record<string, unknown>)
      : {};
  const raw = record.dimensions;
  const dimensions =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.entries(raw)
          .map(([key, value]) => ({
            key: getRubricDimensionLabel(key),
            value: toDisplayText(value, ""),
          }))
          .filter((item) => item.value)
      : [];
  const notes = typeof record.notes === "string" ? record.notes : "";
  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-zinc-900">评分标准</h2>
      {dimensions.length || notes ? (
        <div className="mt-3 space-y-3 break-words text-zinc-700">
          {dimensions.length ? (
            <ul className="space-y-1">
              {dimensions.map((item, index) => (
                <li key={index}>
                  {item.key}：{item.value}
                </li>
              ))}
            </ul>
          ) : null}
          {notes ? <p className="whitespace-pre-wrap">{notes}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-zinc-600">当前未提供评分标准说明</p>
      )}
    </section>
  );
}
