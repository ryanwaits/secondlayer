"use client";

import { useState } from "react";
import { usePreferences } from "@/lib/preferences";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { ManualSteps } from "@/components/console/manual-steps";
import {
  DASHBOARD_BOTH_PROMPT,
  DASHBOARD_STREAMS_PROMPT,
  DASHBOARD_VIEWS_PROMPT,
} from "@/lib/agent-prompts";
import Link from "next/link";

type Mode = "agent" | "manual";

function agentPrompt(streams: boolean, views: boolean) {
  if (streams && views) return DASHBOARD_BOTH_PROMPT;
  if (streams) return DASHBOARD_STREAMS_PROMPT;
  return DASHBOARD_VIEWS_PROMPT;
}

export function DashboardEmpty() {
  const { preferences } = usePreferences();
  const { streams, views } = preferences.products;
  const [mode, setMode] = useState<Mode>("agent");

  if (!streams && !views) {
    return (
      <div className="empty-msg">
        No products enabled.{" "}
        <Link href="/platform/settings">Enable products in Settings</Link>
      </div>
    );
  }

  return (
    <>
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Get started</h2>
      </div>

      <div className="mode-tabs">
        <button
          className={`mode-tab${mode === "agent" ? " active" : ""}`}
          onClick={() => setMode("agent")}
        >
          Agent
        </button>
        <button
          className={`mode-tab${mode === "manual" ? " active" : ""}`}
          onClick={() => setMode("manual")}
        >
          Manual
        </button>
      </div>

      {mode === "agent" ? (
        <AgentPromptBlock
          title="Paste this into your agent to get started"
          code={agentPrompt(streams, views)}
        />
      ) : (
        <ManualSteps streams={streams} views={views} />
      )}
    </>
  );
}
