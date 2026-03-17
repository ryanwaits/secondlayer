"use client";

import { useState, useCallback } from "react";
import { QUICK_STREAM_PROMPT, QUICK_VIEW_PROMPT } from "@/lib/agent-prompts";

function CopyTag({ copied }: { copied: boolean }) {
  return (
    <span className={`copy-sm${copied ? " copied" : ""}`}>
      {copied ? "Copied" : "Copy"}
    </span>
  );
}

function QuickActionCard({
  label,
  desc,
  prompt,
}: {
  label: string;
  desc: string;
  prompt: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [prompt]);

  return (
    <div className="quick-action" onClick={handleCopy}>
      <div className="quick-action-text">
        <span className="quick-action-label">{label}</span>
        <span className="quick-action-desc">{desc}</span>
      </div>
      <CopyTag copied={copied} />
    </div>
  );
}

export function QuickActions({
  streams = true,
  views = true,
}: {
  streams?: boolean;
  views?: boolean;
} = {}) {
  return (
    <div className="quick-actions">
      {streams && (
        <QuickActionCard
          label="Create a stream"
          desc="Webhook event delivery"
          prompt={QUICK_STREAM_PROMPT}
        />
      )}
      {views && (
        <QuickActionCard
          label="Deploy a view"
          desc="Custom blockchain indexer"
          prompt={QUICK_VIEW_PROMPT}
        />
      )}
    </div>
  );
}

export function StreamQuickAction() {
  return <QuickActions streams views={false} />;
}

export function ViewQuickAction() {
  return <QuickActions streams={false} views />;
}
