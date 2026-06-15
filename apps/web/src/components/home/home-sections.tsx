import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { CopyButton } from "@/components/copy-button";
import { MARKETING_HOME_PROMPT } from "@/lib/agent-prompts";
import {
	CLI_SNIPPET,
	INDEX_SNIPPET,
	STREAMS_SNIPPET,
	SUBGRAPHS_SNIPPET,
	SUBSCRIPTIONS_SNIPPET,
} from "@/lib/home-snippets";
import Link from "next/link";
import type { ReactNode } from "react";
import { CliTerminalPane } from "./panes/cli-terminal-pane";
import { IndexResultsPane } from "./panes/index-results-pane";
import { StreamsBlocksPane } from "./panes/streams-blocks-pane";
import { SubgraphSchemaPane } from "./panes/subgraph-schema-pane";
import { WebhookLatencyPane } from "./panes/webhook-latency-pane";

function Feature({
	title,
	docsHref,
	docsLabel = "Read the docs",
	children,
	code,
	lang = "typescript",
	pane,
}: {
	title: string;
	docsHref: string;
	docsLabel?: string;
	children: ReactNode;
	code: string;
	lang?: string;
	pane: ReactNode;
}) {
	return (
		<div className="home-feature">
			<div className="home-feature-head">
				<h3>{title}</h3>
				<p>{children}</p>
				<Link href={docsHref} className="home-docs-link">
					{docsLabel} <span className="ar">→</span>
				</Link>
			</div>
			<div className="home-duo">
				<div className="home-duo-code">
					<CodeBlock code={code} lang={lang} />
				</div>
				<div className="home-duo-pane">{pane}</div>
			</div>
		</div>
	);
}

/** The five capability sections (Streams → Index → Subgraphs → Subscriptions → CLI). */
export function HomeFeatures() {
	return (
		<section className="home-block">
			<div className="home-wrap">
				<Feature
					title="Decoded chain data, kept indexed"
					docsHref="/index-api"
					docsLabel="Explore Index"
					code={INDEX_SNIPPET}
					pane={<IndexResultsPane />}
				>
					Every FT and NFT transfer, contract call, and print event — decoded,
					typed, and cursor-paginated. Read it keyless, or sweep it into your
					own app index: backfill from genesis, reorgs flagged on every page.
				</Feature>

				<Feature
					title="You shape it. We run it."
					docsHref="/subgraphs"
					docsLabel="Explore Subgraphs"
					code={SUBGRAPHS_SNIPPET}
					pane={<SubgraphSchemaPane />}
				>
					Define sources, schema, and handlers in one TypeScript file. Deploy it
					and get typed Postgres tables, a public read API, and a page on
					Explore — live from the moment you deploy, full genesis history on
					paid plans.
				</Feature>

				<Feature
					title="Consume the raw firehose"
					docsHref="/streams"
					docsLabel="Explore Streams"
					code={STREAMS_SNIPPET}
					pane={<StreamsBlocksPane />}
				>
					Every event the chain emits — ordered, cursor-paginated, reorg-aware.
					Resume from any cursor, replay history from signed parquet dumps, or
					hold the tip. This is what you&apos;d run a node for — and what Index
					itself is built on.
				</Feature>

				<Feature
					title="Webhooks when it happens"
					docsHref="/docs/subscriptions"
					code={SUBSCRIPTIONS_SNIPPET}
					pane={<WebhookLatencyPane />}
				>
					Subscribe to chain events or your subgraph rows and get signed
					deliveries with retries and circuit breakers. The push channel for
					Index and Subgraphs — no polling loop to babysit.
				</Feature>

				<Feature
					title="The same API, from your shell"
					docsHref="/docs/cli"
					code={CLI_SNIPPET}
					lang="bash"
					pane={<CliTerminalPane />}
				>
					Every surface is also a command. Scaffold, deploy, query, tail —
					pipeable, scriptable, JSON when you ask for it. Local devnet included.
				</Feature>
			</div>
		</section>
	);
}

/** Get-started split: run it yourself / hand it to your agent. */
export function HomeGetStarted() {
	return (
		<section className="home-block" style={{ paddingTop: 0 }}>
			<div className="home-wrap">
				<p className="home-kicker">Get started</p>
				<h2 className="home-h2">Run it yourself. Or hand it to your agent.</h2>
				<p className="home-lede">
					Reads need no key, deploys need one command — and the whole surface
					speaks MCP, so the fastest path might be pasting one block into your
					harness.
				</p>
				<div className="home-gs home-gs-single">
					<div className="home-gs-card">
						<div className="home-gs-head">
							<span className="t">In your agent&apos;s harness</span>
							<CopyButton code={MARKETING_HOME_PROMPT} inline />
						</div>
						<div className="home-harness-row" aria-label="Works with">
							<span className="home-harness">Claude Code</span>
							<span className="home-harness">Cursor</span>
							<span className="home-harness">Codex</span>
							<span className="home-harness">any MCP client</span>
						</div>
						<AgentPromptBlock code={MARKETING_HOME_PROMPT} showCopy={false} />
					</div>
				</div>
			</div>
		</section>
	);
}
