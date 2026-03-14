"use client";

import { useState } from "react";
import type { ComponentRenderProps } from "@json-render/react";

interface DetailSectionProps {
  label: string;
  defaultOpen?: boolean;
  badge?: string;
}

export function DetailSection({ element, children }: ComponentRenderProps<DetailSectionProps>) {
  const { label, defaultOpen, badge } = element.props;
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="palette-detail-section">
      <button
        className="palette-detail-trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <svg
          className={`palette-detail-chevron ${open ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="palette-detail-label">{label}</span>
        {badge && <span className="palette-detail-badge">{badge}</span>}
      </button>
      {open && <div className="palette-detail-content">{children}</div>}
    </div>
  );
}
