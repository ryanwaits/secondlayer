"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";

type Pkg = "npm" | "yarn" | "pnpm" | "bun";

const PKG_COMMANDS: Record<Pkg, string> = {
  npm: "npm install -g @secondlayer/cli",
  yarn: "yarn global add @secondlayer/cli",
  pnpm: "pnpm add -g @secondlayer/cli",
  bun: "bun add -g @secondlayer/cli",
};

function TerminalBlock({
  command,
  pkgTabs,
}: {
  command?: string;
  pkgTabs?: boolean;
}) {
  const [pkg, setPkg] = useState<Pkg>("npm");
  const cmd = pkgTabs ? PKG_COMMANDS[pkg] : command!;

  return (
    <div className="step-code">
      <div className="step-code-header">
        <div className="step-code-header-left">
          <span style={{ opacity: 0.5 }}>&#9658;_</span>
          <span>Terminal</span>
        </div>
        {pkgTabs && (
          <div className="install-tabs">
            {(["npm", "yarn", "pnpm", "bun"] as Pkg[]).map((p) => (
              <button
                key={p}
                className={`install-tab${pkg === p ? " active" : ""}`}
                onClick={() => setPkg(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="step-code-body">
        <span>
          <span className="dollar">$</span>
          <span className="cmd-text">{cmd}</span>
        </span>
        <CopyButton code={cmd} />
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  last,
  children,
}: {
  number: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="step">
      <div className="step-indicator">
        <div className="step-number">{number}</div>
        {!last && <div className="step-line" />}
      </div>
      <div className="step-content">
        <div className="step-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function ManualSteps({
  streams,
  subgraphs,
}: {
  streams: boolean;
  subgraphs: boolean;
}) {
  const step3Title =
    streams && subgraphs
      ? "Create your first resource"
      : streams
        ? "Create your first stream"
        : "Deploy your first subgraph";

  return (
    <div className="steps">
      <Step number={1} title="Install the CLI">
        <TerminalBlock pkgTabs />
      </Step>
      <Step number={2} title="Authenticate">
        <TerminalBlock command="secondlayer auth login" />
      </Step>
      <Step number={3} title={step3Title} last>
        {streams && (
          <div style={streams && subgraphs ? { marginBottom: 6 } : undefined}>
            <TerminalBlock command="secondlayer streams create" />
          </div>
        )}
        {subgraphs && <TerminalBlock command="secondlayer subgraphs init" />}
      </Step>
    </div>
  );
}
