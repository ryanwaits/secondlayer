"use client";

import { CopyButton } from "@/components/copy-button";
import { useState } from "react";
import { AgentPromptBlock } from "./agent-prompt";

const PKG_COMMANDS: Record<string, string> = {
	npm: "npm install -g @secondlayer/cli",
	yarn: "yarn global add @secondlayer/cli",
	pnpm: "pnpm add -g @secondlayer/cli",
	bun: "bun add -g @secondlayer/cli",
};

function TerminalBlock({
	command,
	headerRight,
}: {
	command: string;
	headerRight?: React.ReactNode;
}) {
	return (
		<div className="gs-code">
			<div className="gs-code-header">
				<div className="gs-code-header-left">
					<span style={{ opacity: 0.5 }}>&#9658;_</span>
					<span>Terminal</span>
				</div>
				{headerRight}
			</div>
			<div className="gs-code-body">
				<span>
					<span className="dollar">$</span>
					{command}
				</span>
				<CopyButton code={command} />
			</div>
		</div>
	);
}

function ManualSteps({
	createCommand,
	createLabel,
}: {
	createCommand: string;
	createLabel: string;
}) {
	const [pkg, setPkg] = useState("npm");

	return (
		<div className="gs-steps">
			<div className="gs-step">
				<div className="gs-step-indicator">
					<div className="gs-step-number">1</div>
					<div className="gs-step-line" />
				</div>
				<div className="gs-step-content">
					<div className="gs-step-title">Install the CLI</div>
					<TerminalBlock
						command={PKG_COMMANDS[pkg]}
						headerRight={
							<div className="install-tabs">
								{Object.keys(PKG_COMMANDS).map((p) => (
									<button
										key={p}
										className={`install-tab${p === pkg ? " active" : ""}`}
										onClick={() => setPkg(p)}
									>
										{p}
									</button>
								))}
							</div>
						}
					/>
				</div>
			</div>

			<div className="gs-step">
				<div className="gs-step-indicator">
					<div className="gs-step-number">2</div>
					<div className="gs-step-line" />
				</div>
				<div className="gs-step-content">
					<div className="gs-step-title">Authenticate</div>
					<TerminalBlock command="secondlayer auth login" />
				</div>
			</div>

			<div className="gs-step">
				<div className="gs-step-indicator">
					<div className="gs-step-number">3</div>
				</div>
				<div className="gs-step-content">
					<div className="gs-step-title">{createLabel}</div>
					<TerminalBlock command={createCommand} />
				</div>
			</div>
		</div>
	);
}

export function GettingStarted({
	agentPrompt,
	createCommand,
	createLabel,
}: {
	agentPrompt: string;
	createCommand: string;
	createLabel: string;
}) {
	const [mode, setMode] = useState<"agent" | "manual">("agent");

	return (
		<>
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
					code={agentPrompt}
				/>
			) : (
				<ManualSteps createCommand={createCommand} createLabel={createLabel} />
			)}
		</>
	);
}
