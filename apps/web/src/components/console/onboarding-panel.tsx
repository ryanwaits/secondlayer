"use client";

import { useState } from "react";
import { usePreferences } from "@/lib/preferences";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="wp-option-tag"
      style={{ cursor: "pointer", border: "none" }}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function OnboardingPanel() {
  const { completeOnboarding } = usePreferences();

  return (
    <div className="onboarding-overlay">
      <div className="wizard-panel">
        <div className="wp-body">
          <div className="wp-question">Get started</div>
          <div className="wp-sub">
            Install the tools to start building with Secondlayer.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="install-row">
              <span className="install-label">CLI</span>
              <span className="install-cmd">
                npm install -g @secondlayer/cli
              </span>
              <CopyButton text="npm install -g @secondlayer/cli" />
            </div>
            <div className="install-row">
              <span className="install-label">Skill</span>
              <span className="install-cmd">
                npx skills add ryanwaits/secondlayer --skill secondlayer
              </span>
              <CopyButton text="npx skills add ryanwaits/secondlayer --skill secondlayer" />
            </div>
          </div>
        </div>

        <div className="wp-footer">
          <button className="wp-go" onClick={completeOnboarding}>
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
