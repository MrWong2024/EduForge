"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type LifecycleListFeedback = {
  message: string | null;
  summaryRef: RefObject<HTMLDivElement | null>;
  clearFeedback: () => void;
  showSuccess: (message: string, departingRow?: HTMLTableRowElement | null) => void;
};

const LifecycleListContext = createContext<LifecycleListFeedback | null>(null);

export function TeacherLifecycleList({
  children,
  validPageHref,
}: {
  children: ReactNode;
  validPageHref?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (validPageHref) router.replace(validPageHref, { scroll: false });
  }, [router, validPageHref]);

  const showSuccess = (message: string, departingRow?: HTMLTableRowElement | null) => {
    setMessage(message);
    if (departingRow?.contains(document.activeElement)) {
      summaryRef.current?.focus();
    }
  };

  return (
    <LifecycleListContext.Provider
      value={{ message, summaryRef, clearFeedback: () => setMessage(null), showSuccess }}
    >
      <section className="space-y-4">{children}</section>
    </LifecycleListContext.Provider>
  );
}

export function useTeacherLifecycleList() {
  const feedback = useContext(LifecycleListContext);
  if (!feedback) {
    throw new Error("Course and classroom actions require TeacherLifecycleList.");
  }
  return feedback;
}

export function TeacherLifecycleListSummary({ children }: { children: ReactNode }) {
  const { message, summaryRef } = useTeacherLifecycleList();

  return (
    <div ref={summaryRef} tabIndex={-1} className="text-sm text-zinc-600">
      {children}
      <p role="status" className={message ? "mt-2 text-emerald-700" : undefined}>
        {message}
      </p>
    </div>
  );
}
