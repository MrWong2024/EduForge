"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

type ClassroomTaskPublishReceipt = {
  id: string;
  dueAt?: string;
  allowLate: boolean;
};

type ListInteractions = {
  receipt: [
    ClassroomTaskPublishReceipt | null,
    Dispatch<SetStateAction<ClassroomTaskPublishReceipt | null>>,
  ];
  deletionNotice: string | null;
  setDeletionNotice: (notice: string | null) => void;
};

const TaskListContext = createContext<ListInteractions | null>(null);

export function ClassroomTaskListInteractions({
  children,
  validPageHref,
}: {
  children: ReactNode;
  validPageHref?: string;
}) {
  const router = useRouter();
  const receipt = useState<ClassroomTaskPublishReceipt | null>(null);
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (validPageHref) router.replace(validPageHref, { scroll: false });
  }, [router, validPageHref]);

  return (
    <TaskListContext.Provider value={{ receipt, deletionNotice, setDeletionNotice }}>
      {children}
    </TaskListContext.Provider>
  );
}

export function useClassroomTaskListInteractions() {
  const interactions = useContext(TaskListContext);
  if (!interactions) {
    throw new Error("The classroom task page must provide list interaction state.");
  }
  return interactions;
}

export function useClassroomTaskPublishReceipt() {
  return useClassroomTaskListInteractions().receipt;
}

export function ClassroomTaskDeletionNotice() {
  const { deletionNotice } = useClassroomTaskListInteractions();
  return deletionNotice ? (
    <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {deletionNotice}
    </p>
  ) : null;
}
