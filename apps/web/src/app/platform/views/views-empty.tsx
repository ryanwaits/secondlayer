"use client";

import { useState } from "react";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { ManualSteps } from "@/components/console/manual-steps";
import { VIEWS_EMPTY_PROMPT } from "@/lib/agent-prompts";

type Mode = "agent" | "manual";

export function ViewsEmpty() {
  const [mode, setMode] = useState<Mode>("agent");

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
          title="Paste this into your agent"
          code={VIEWS_EMPTY_PROMPT}
        />
      ) : (
        <ManualSteps streams={false} views />
      )}
    </>
  );
}
