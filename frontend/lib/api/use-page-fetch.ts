"use client";

import { createContext, useContext, useMemo } from "react";
import { createPageFetch, type PageAccountScope } from "./browser-client";

export type { PageFetch } from "./browser-client";

export const PageAccountContext = createContext<PageAccountScope | undefined>(
  undefined,
);

export function usePageFetch() {
  const scope = useContext(PageAccountContext);
  return useMemo(() => createPageFetch(scope), [scope]);
}
