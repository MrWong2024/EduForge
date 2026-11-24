"use client";

import { useId, useLayoutEffect, useRef } from "react";

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    cancelButtonRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-lg backdrop:bg-zinc-950/50"
    >
      <h2 id={titleId} className="break-words text-base font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-zinc-700">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelButtonRef}
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${destructive ? "bg-red-700 hover:bg-red-800" : "bg-zinc-900 hover:bg-zinc-700"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
