"use client";

import { useDismiss } from "./use-dismiss";

interface InsightAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface InsightProps {
  variant?: "default" | "warning" | "danger" | "success" | "info";
  children: React.ReactNode;
  actions?: InsightAction[];
  id?: string;
}

const variantClass: Record<string, string> = {
  warning: "insight-warning",
  danger: "insight-danger",
  success: "insight-success",
  info: "insight-info",
};

export function Insight({ variant = "default", children, actions, id }: InsightProps) {
  const { dismissed, dismiss } = useDismiss(id ?? "");
  if (id && dismissed) return null;

  return (
    <div className={`insight ${variantClass[variant] ?? ""}`}>
      <div>{children}</div>
      {(actions || id) && (
        <div className="insight-actions">
          {actions?.map((a) => (
            <button
              key={a.label}
              className={`insight-action ${a.primary ? "insight-action-primary" : ""}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
          {id && (
            <button className="insight-action" onClick={dismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
