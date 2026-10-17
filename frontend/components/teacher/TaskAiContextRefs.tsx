"use client";

import { useId } from "react";
import {
  formatAiContextRefs,
  parseAiContextRefsJson,
  type TaskAiContextRef,
} from "@/lib/learning-tasks/ai-context-refs";

export function TaskAiContextRefsEditor({
  value,
  onChange,
  error,
  onError,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  onError: (message: string | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <h3 className="text-sm font-medium text-zinc-900">AI 评阅参考资料</h3>
      <label htmlFor={id} className="mt-2 block text-sm text-zinc-700">
        引用 JSON
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onError(null);
        }}
        disabled={disabled}
        rows={8}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          try {
            onChange(formatAiContextRefs(parseAiContextRefsJson(value)));
            onError(null);
          } catch (error) {
            onError(
              error instanceof Error ? error.message : "引用 JSON 无法格式化。",
            );
          }
        }}
        className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        格式化
      </button>
      <div id={`${id}-help`} className="mt-2 space-y-1 text-xs text-zinc-600">
        <p>填写 [] 可清除引用。</p>
        <p>压缩包路径相对于项目 .local 目录，包内路径须与 ZIP 中一致。</p>
        <p>修改仅影响以后发布的课堂任务，已发布课堂继续使用原快照。</p>
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 break-words text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function TaskAiContextRefsReadOnly({
  refs,
}: {
  refs: TaskAiContextRef[];
}) {
  if (!refs.length) {
    return null;
  }
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <h3 className="text-sm font-medium text-zinc-900">AI 评阅参考资料</h3>
      <div className="mt-2 space-y-3 text-sm">
        {refs.map((ref, index) => (
          <div key={index}>
            <p className="break-all font-medium text-zinc-800">
              {ref.archivePath}
            </p>
            <ul className="mt-1 list-inside list-disc text-zinc-700">
              {ref.entryPaths.map((path, entryIndex) => (
                <li key={entryIndex} className="break-all">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
