"use client";

import { GettingStarted } from "@/components/console/getting-started";
import {
	QuickStartCard,
	QuickStartSection,
} from "@/components/console/quick-start-card";
import { SUBGRAPHS_EMPTY_PROMPT } from "@/lib/agent-prompts";

export function SubgraphsEmpty() {
	return (
		<>
			<p className="dash-empty">
				No subgraphs yet. Get set up and deploy your first subgraph.
			</p>

			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">Get started</h2>
			</div>

			<GettingStarted
				agentPrompt={SUBGRAPHS_EMPTY_PROMPT}
				createCommand="secondlayer subgraphs new my-subgraph"
				createLabel="Deploy your first subgraph"
			/>

			<QuickStartSection>
				<QuickStartCard
					icon={
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						>
							<rect x="2" y="2" width="12" height="12" rx="2" />
							<path d="M5 6h6M5 8h4M5 10h5" />
						</svg>
					}
					label="Deploy a subgraph"
					description="Custom blockchain indexer"
					copyText="Scaffold a subgraph that indexes swap events from the ALEX DEX contract SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 and deploy it"
				/>
			</QuickStartSection>
		</>
	);
}
