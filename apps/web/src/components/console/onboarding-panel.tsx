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

const CheckIcon = (
  <svg
    className="wp-check-icon"
    width="10"
    height="10"
    viewBox="0 0 16 16"
    fill="none"
    stroke="#fff"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export function OnboardingPanel() {
  const { setProducts, completeOnboarding } = usePreferences();
  const [streams, setStreams] = useState(true);
  const [subgraphs, setSubgraphs] = useState(true);

  function handleSkip() {
    setProducts({ streams: true, subgraphs: true });
    completeOnboarding();
  }

  function handleGo() {
    setProducts({ streams, subgraphs });
    completeOnboarding();
  }

  return (
    <div className="onboarding-overlay">
      <div className="wizard-panel">
        <div className="wp-body">
          <div className="wp-question">Configure your workspace</div>
          <div className="wp-sub">
            Select products and install the tools. Change anytime in Settings.
          </div>

          <div className="wp-options" style={{ marginBottom: 20 }}>
            <div
              className={`wp-option${streams ? " selected" : ""}`}
              onClick={() => setStreams(!streams)}
            >
              <div className="wp-check">{CheckIcon}</div>
              <div className="wp-option-content">
                <div className="wp-option-name">Streams</div>
                <div className="wp-option-desc">
                  Real-time delivery for on-chain events
                </div>
              </div>
              <span className="wp-option-tag">push</span>
            </div>

            <div
              className={`wp-option${subgraphs ? " selected" : ""}`}
              onClick={() => setSubgraphs(!subgraphs)}
            >
              <div className="wp-check">{CheckIcon}</div>
              <div className="wp-option-content">
                <div className="wp-option-name">Subgraphs</div>
                <div className="wp-option-desc">
                  SQL indexer for blockchain data
                </div>
              </div>
              <span className="wp-option-tag">pull</span>
            </div>
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
          <button className="wp-skip" onClick={handleSkip}>
            Skip — enable everything
          </button>
          <button
            className="wp-go"
            onClick={handleGo}
            disabled={!streams && !subgraphs}
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
