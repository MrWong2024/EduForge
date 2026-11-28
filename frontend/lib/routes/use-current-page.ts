"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export function useCurrentPage() {
  const pathname = usePathname();
  const activePage = useRef<symbol | null>(null);

  useLayoutEffect(() => {
    activePage.current = Symbol();
    return () => {
      activePage.current = null;
    };
  }, [pathname]);

  // A request keeps its original page lifetime even if this URL is visited again.
  return function captureCurrentPage() {
    const origin = activePage.current;
    return () => origin !== null && activePage.current === origin;
  };
}
