"use client";

import { useState, useCallback } from "react";

export function useDismiss(id: string) {
  const key = `sl-dismiss:${id}`;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(key) === "1";
  });

  const dismiss = useCallback(() => {
    sessionStorage.setItem(key, "1");
    setDismissed(true);
  }, [key]);

  return { dismissed, dismiss };
}
