"use client";

import { createContext, useContext, useState, useCallback } from "react";

type Overrides = Record<string, string>;

const BreadcrumbCtx = createContext<{
  overrides: Overrides;
  set: (path: string, label: string) => void;
}>({ overrides: {}, set: () => {} });

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const set = useCallback((path: string, label: string) => {
    setOverrides((prev) => (prev[path] === label ? prev : { ...prev, [path]: label }));
  }, []);
  return (
    <BreadcrumbCtx.Provider value={{ overrides, set }}>
      {children}
    </BreadcrumbCtx.Provider>
  );
}

export function useBreadcrumbOverrides() {
  return useContext(BreadcrumbCtx);
}
