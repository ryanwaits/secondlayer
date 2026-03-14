"use client";

import type { ComponentRenderProps } from "@json-render/react";
import type { ReactNode } from "react";

interface ConfirmCardProps {
  title: string;
  description?: string;
  destructive?: boolean;
}

export function ConfirmCard({ element, children, emit, on }: ComponentRenderProps<ConfirmCardProps>) {
  const { title, description, destructive } = element.props;
  const executeHandle = on("execute");
  const cancelHandle = on("cancel");

  return (
    <div className="palette-confirm">
      <div className="palette-confirm-header">{title}</div>
      {description && (
        <div className="palette-confirm-desc">{description}</div>
      )}
      <div className="palette-confirm-list">{children}</div>
      <div className="palette-confirm-actions">
        <button
          className="palette-btn"
          onClick={() => emit("cancel")}
        >
          Cancel
        </button>
        <button
          className={`palette-btn ${destructive ? "palette-btn-danger" : ""}`}
          onClick={() => emit("execute")}
        >
          {title}
        </button>
      </div>
    </div>
  );
}
