"use client";

import { useDismiss } from "./use-dismiss";

interface HintProps {
  children: React.ReactNode;
  id: string;
}

export function Hint({ children, id }: HintProps) {
  const { dismissed, dismiss } = useDismiss(id);
  if (dismissed) return null;

  return (
    <div className="hint">
      <div className="hint-text">{children}</div>
      <span className="hint-dismiss" onClick={dismiss}>
        ×
      </span>
    </div>
  );
}
