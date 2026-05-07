import { DatasetSandbox } from "@/components/dataset-sandbox";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export const metadata: Metadata = {
	title: "Quickstart | secondlayer",
	description:
		"Query Stacks chain data in 30 seconds. No install, no key. Foundation Datasets are public.",
};

const toc: TocItem[] = [
	{ label: "30 seconds: curl", href: "#curl" },
	{ label: "Try it live", href: "#try-it" },
	{ label: "1 minute: in your app", href: "#fetch" },
	{ label: "Foundation Datasets", href: "#datasets" },
	{ label: "5 minutes: custom shape", href: "#subgraphs" },
	{ label: "Going further", href: "#further" },
];

const API_BASE = "https://api.secondlayer.tools";

export default function QuickstartPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Quickstart" toc={toc} />
			<QuickstartContent />
		</div>
	);
}

export function QuickstartContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Quickstart</h1>
			</header>

			<div className="prose">
				<p>
					Query Stacks chain data in 30 seconds. No install, no API key, no
					signup. The five Foundation Datasets are public goods —{" "}
					<code>curl</code> them, fetch them from your app, or build your own
					indexed shape on top.
				</p>
			</div>

			<SectionHeading id="curl">30 seconds: curl</SectionHeading>

			<div className="prose">
				<p>
					Pick a dataset and hit it. Every endpoint returns JSON with{" "}
					<code>events</code> (or <code>calls</code>) and a{" "}
					<code>next_cursor</code> for pagination.
				</p>
			</div>

			<InlineCodeBlock>
				{`# sBTC deposits, withdrawals, signer rotations
curl "${API_BASE}/v1/datasets/sbtc/events?limit=5"

# Recent STX transfers
curl "${API_BASE}/v1/datasets/stx-transfers?limit=5"

# Stacking activity (PoX-4)
curl "${API_BASE}/v1/datasets/pox-4/calls?function_name=stack-stx&limit=5"

# Resolve a BNS name
curl "${API_BASE}/v1/datasets/bns/resolve?fqn=alice.btc"

# Network health summary (last 7 days)
curl "${API_BASE}/v1/datasets/network-health/summary?days=7"`}
			</InlineCodeBlock>

			<SectionHeading id="try-it">Try it live</SectionHeading>

			<div className="prose">
				<p>
					No browser console required. Tweak the filters, hit Send — same
					endpoint your code will call.
				</p>
			</div>

			<DatasetSandbox
				endpoint="/v1/datasets/sbtc/events"
				title="sBTC events"
				filters={[
					{
						name: "topic",
						type: "enum",
						options: [
							"completed-deposit",
							"withdrawal-create",
							"withdrawal-accept",
							"withdrawal-reject",
							"key-rotation",
							"update-protocol-contract",
						],
						default: "completed-deposit",
					},
					{ name: "limit", type: "number", default: "5", placeholder: "5" },
					{
						name: "request_id",
						type: "number",
						placeholder: "withdrawal request id",
					},
					{ name: "sender", type: "string", placeholder: "SP1..." },
				]}
			/>

			<SectionHeading id="fetch">1 minute: in your app</SectionHeading>

			<div className="prose">
				<p>
					Same endpoints from any language. Below are 4-line snippets for the
					sBTC events endpoint — swap the URL for any other dataset.
				</p>
			</div>

			<div className="prose">
				<p>TypeScript / JavaScript:</p>
			</div>

			<InlineCodeBlock>
				{`const res = await fetch(
  "${API_BASE}/v1/datasets/sbtc/events?topic=completed-deposit&limit=20",
);
const { events, next_cursor, tip } = await res.json();
console.log(events.length, "events; chain tip", tip.block_height);`}
			</InlineCodeBlock>

			<div className="prose">
				<p>Python:</p>
			</div>

			<InlineCodeBlock>
				{`import requests
res = requests.get(
    "${API_BASE}/v1/datasets/sbtc/events",
    params={"topic": "completed-deposit", "limit": 20},
).json()
print(len(res["events"]), "events; chain tip", res["tip"]["block_height"])`}
			</InlineCodeBlock>

			<div className="prose">
				<p>Go:</p>
			</div>

			<InlineCodeBlock>
				{`res, _ := http.Get("${API_BASE}/v1/datasets/sbtc/events?topic=completed-deposit&limit=20")
defer res.Body.Close()
var body struct {
    Events     []map[string]any \`json:"events"\`
    NextCursor *string          \`json:"next_cursor"\`
    Tip        struct{ BlockHeight int \`json:"block_height"\` } \`json:"tip"\`
}
json.NewDecoder(res.Body).Decode(&body)`}
			</InlineCodeBlock>

			<SectionHeading id="datasets">Foundation Datasets</SectionHeading>

			<div className="prose">
				<p>
					Five public-good datasets covering the canonical Stacks reference
					queries. Each has a stable schema, freshness reporting via{" "}
					<code>/public/status</code>, and (for some) parquet bulk dumps.
				</p>
				<ul>
					<li>
						<a href="/datasets/stx-transfers">STX Transfers</a> — every
						canonical STX transfer event.
					</li>
					<li>
						<a href="/datasets/sbtc">sBTC</a> — deposits, withdrawals, signer
						rotations, plus SIP-010 mint/burn/transfer.
					</li>
					<li>
						<a href="/datasets/pox-4">PoX-4 / Stacking</a> — every Stacking
						lifecycle call decoded with cycle math, BTC payout addresses, and
						signer keys.
					</li>
					<li>
						<a href="/datasets/bns">BNS</a> — BNS-V2 names, namespaces,
						marketplace listings, plus a current-state <code>resolve(fqn)</code>{" "}
						projection.
					</li>
					<li>
						<a href="/datasets/network-health">Network Health</a> — daily block
						count, average block time, reorg counts.
					</li>
				</ul>
			</div>

			<SectionHeading id="subgraphs">5 minutes: custom shape</SectionHeading>

			<div className="prose">
				<p>
					Foundation Datasets cover the common cases. If you need shape we
					didn't anticipate — your own contract's events, a custom join, a
					per-app rollup — write a subgraph instead. Subgraphs run against the
					same Streams events feed and write into your own Postgres tables.
				</p>
			</div>

			<InlineCodeBlock>
				{`# Install
bun add -g @secondlayer/cli

# Scaffold a subgraph from a Foundation Dataset template
sl subgraphs new my-balances --template sip-010-balances

# Run locally against the public Streams feed (no signup)
sl subgraphs dev subgraphs/my-balances.ts

# Or deploy to a dedicated instance
sl login
sl instance create --plan hobby   # free tier, auto-pauses after 7d idle
sl subgraphs deploy subgraphs/my-balances.ts
sl subgraphs query my-balances balances`}
			</InlineCodeBlock>

			<div className="prose">
				<p>
					Each template is a complete, runnable subgraph that mirrors a
					Foundation Dataset's shape — copy, modify, ship. Available templates:{" "}
					<code>sip-010-balances</code>, <code>sbtc-flows</code>,{" "}
					<code>pox-stacking</code>, <code>bns-names</code>.
				</p>
			</div>

			<SectionHeading id="further">Going further</SectionHeading>

			<div className="prose">
				<ul>
					<li>
						<a href="/datasets">Browse the dataset shelf</a> — every endpoint,
						every filter, every schema column.
					</li>
					<li>
						<a href="/cli">CLI reference</a> — full <code>sl</code> command
						surface for projects, instances, subgraphs, and subscriptions.
					</li>
					<li>
						<a href="/sdk">SDK</a> — typed TypeScript client for Streams, Index,
						and subgraph queries.
					</li>
					<li>
						<a href="/subgraphs">Subgraphs</a> — full subgraph definition guide.
					</li>
					<li>
						<a href="/pricing">Pricing</a> — Hobby (free), Launch, Grow, Scale
						compute tiers; Enterprise on request.
					</li>
				</ul>
				<p>
					Real-time freshness for every public surface lives at{" "}
					<a href="/public/status">/public/status</a>.
				</p>
			</div>
		</main>
	);
}
