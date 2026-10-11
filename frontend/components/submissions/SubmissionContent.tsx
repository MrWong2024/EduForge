import type { SubmissionDetailResponse } from "@/lib/api/types-student";
import { getTaskSnapshotMessage } from "@/lib/learning-tasks/ai-review";
export function SubmissionContent({
  detail,
}: {
  detail: SubmissionDetailResponse;
}) {
  const code = detail.content.codeText,
    note = detail.content.submissionNote,
    declaration = detail.meta?.aiUsageDeclaration;
  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900">
      <h2 className="text-base font-semibold text-zinc-900">本次提交内容</h2>
      <p className="break-words text-xs text-zinc-600">
        {getTaskSnapshotMessage(detail.taskSnapshotAvailable)}
      </p>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">源码</h3>
        {typeof code === "string" && code.length > 0 ? (
          <pre className="mt-2 max-h-[28rem] max-w-full overflow-auto whitespace-pre rounded-md bg-zinc-900 p-3 text-xs text-zinc-100">
            {code}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">当前接口未返回代码内容。</p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">提交说明</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-700">
          {typeof note === "string"
            ? note.length > 0
              ? note
              : "未填写提交说明"
            : "提交说明信息暂不可用，请刷新核对。"}
        </p>
      </div>
      {declaration !== undefined ? (
        <div>
          <h3 className="text-sm font-medium">AI 使用声明（学生自述）</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-700">
            {declaration || "未填写 AI 使用声明"}
          </p>
        </div>
      ) : null}
    </section>
  );
}
