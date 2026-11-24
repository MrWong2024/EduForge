"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

const PublishReceiptContext = createContext<
  [string | null, Dispatch<SetStateAction<string | null>>] | null
>(null);

export function ClassroomTaskListInteractions({
  children,
  validPageHref,
}: {
  children: ReactNode;
  validPageHref?: string;
}) {
  const router = useRouter();
  const receipt = useState<string | null>(null);

  useEffect(() => {
    if (validPageHref) router.replace(validPageHref, { scroll: false });
  }, [router, validPageHref]);

  return (
    <PublishReceiptContext.Provider value={receipt}>
      {children}
    </PublishReceiptContext.Provider>
  );
}

export function useClassroomTaskPublishReceipt() {
  const receipt = useContext(PublishReceiptContext);
  if (!receipt) {
    throw new Error("The classroom task page must provide publish receipt state.");
  }
  return receipt;
}
