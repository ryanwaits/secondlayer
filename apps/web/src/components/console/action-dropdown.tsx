"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { DROPDOWN_CREATE_STREAM, DROPDOWN_DEPLOY_SUBGRAPH } from "@/lib/agent-prompts";

interface ActionItem {
  label: string;
  description: string;
  copyText: string;
  icon?: "stream" | "subgraph";
}

const ICONS = {
  stream: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4l6 4 6-4M2 4v8l6 4 6-4V4M2 4l6-4 6 4" />
    </svg>
  ),
  subgraph: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 6h6M5 8h4M5 10h5" />
    </svg>
  ),
};

const DASHBOARD_ITEMS: ActionItem[] = [
  { label: "Create a stream", description: "Copy agent prompt", copyText: DROPDOWN_CREATE_STREAM, icon: "stream" },
  { label: "Deploy a subgraph", description: "Copy agent prompt", copyText: DROPDOWN_DEPLOY_SUBGRAPH, icon: "subgraph" },
];

const STREAMS_ITEMS: ActionItem[] = [
  { label: "Create a stream", description: "Copy agent prompt", copyText: DROPDOWN_CREATE_STREAM, icon: "stream" },
];

const SUBGRAPHS_ITEMS: ActionItem[] = [
  { label: "Deploy a subgraph", description: "Copy agent prompt", copyText: DROPDOWN_DEPLOY_SUBGRAPH, icon: "subgraph" },
];

export function ActionDropdown({
  variant = "dashboard",
}: {
  variant?: "dashboard" | "streams" | "subgraphs";
}) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const items = variant === "streams" ? STREAMS_ITEMS : variant === "subgraphs" ? SUBGRAPHS_ITEMS : DASHBOARD_ITEMS;

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  function handleCopy(item: ActionItem) {
    navigator.clipboard.writeText(item.copyText).then(() => {
      setCopiedKey(item.label);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  return (
    <div className="action-dropdown-wrap" ref={ref}>
      <button
        className="dash-btn prompts-btn"
        onClick={() => setOpen(!open)}
      >
        Actions
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s", marginLeft: 4 }}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="action-dropdown-menu">
          {items.map((item) => (
            <div
              key={item.label}
              className="action-dropdown-item"
              onClick={() => handleCopy(item)}
              style={{ cursor: "pointer" }}
            >
              {item.icon && (
                <div className="action-dropdown-icon">
                  {ICONS[item.icon]}
                </div>
              )}
              <div className="action-dropdown-text">
                <span className="action-dropdown-label">{item.label}</span>
                <span className="action-dropdown-desc">
                  {copiedKey === item.label ? "Copied" : item.description}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
