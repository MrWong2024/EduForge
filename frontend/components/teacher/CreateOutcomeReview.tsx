import Link from "next/link";

export function CreateOutcomeReview({
  listHref,
  listLabel,
  onConfirm,
}: {
  listHref: string;
  listLabel: string;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p role="status">可能已创建，请先核对列表。表单输入已保留。</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href={listHref}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          className="text-blue-700 underline"
        >
          {listLabel}（新标签页）
        </Link>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-amber-300 px-3 py-1.5 hover:bg-amber-100"
        >
          已核对，可以再次创建
        </button>
      </div>
    </div>
  );
}
