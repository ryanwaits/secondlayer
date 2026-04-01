"use client";

import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { DASHBOARD_BOTH_PROMPT } from "@/lib/agent-prompts";

export function DashboardEmpty() {
	return (
		<>
			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">Get started</h2>
			</div>

			<AgentPromptBlock
				title="Paste this into your agent to get started"
				code={DASHBOARD_BOTH_PROMPT}
			/>
		</>
	);
}
