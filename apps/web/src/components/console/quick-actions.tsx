"use client";

import { useState, useCallback } from "react";
import { QUICK_STREAM_PROMPT, QUICK_SUBGRAPH_PROMPT } from "@/lib/agent-prompts";

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
  subgraphs = true,
}: {
  streams?: boolean;
  subgraphs?: boolean;
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
      {subgraphs && (
        <QuickActionCard
          label="Deploy a subgraph"
          desc="Custom blockchain indexer"
          prompt={QUICK_SUBGRAPH_PROMPT}
        />
      )}
    </div>
  );
}

export function StreamQuickAction() {
  return <QuickActions streams subgraphs={false} />;
}

export function SubgraphQuickAction() {
  return <QuickActions streams={false} subgraphs />;
}
