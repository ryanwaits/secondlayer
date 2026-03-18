"use client";

import Link from "next/link";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SUBGRAPHS_EMPTY_PROMPT } from "@/lib/agent-prompts";

export function SubgraphsEmpty() {
  return (
    <>
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Get started</h2>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Link href="/subgraphs/templates" className="scaffold-btn">
          Browse templates
        </Link>
        <Link href="/subgraphs/scaffold" className="scaffold-btn">
          Scaffold from contract
        </Link>
      </div>

      <AgentPromptBlock
        title="Paste this into your agent"
        code={SUBGRAPHS_EMPTY_PROMPT}
      />
    </>
  );
}
