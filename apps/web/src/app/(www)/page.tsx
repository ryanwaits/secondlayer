import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the data plane for Stacks",
	description:
		"Streams, Subgraphs, Subscriptions, Foundation Datasets. Public APIs free forever, hosted infrastructure on top. Launching May 27.",
};

// Sync (non-shiki) code block — keeps the home server-renderable in tests.
// Use the async <CodeBlock> for sub-pages that don't need to be smoke-tested
// with renderToStaticMarkup.
function Code({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function Home() {
	return (
		<div className="homepage">
			<header className="page-header">
				<h1 className="page-title">secondlayer</h1>
				<p className="page-sub">the data plane for Stacks · launching May 27</p>
			</header>

			<div className="prose" style={{ marginTop: "var(--spacing-xl)" }}>
				<p>
					Four addressable layers — pick whichever your workload needs. Public
					APIs work today; <Link href="/pricing">paid plans</Link> open May 27.{" "}
					<Link href="/status">Status</Link>.
				</p>
			</div>

			<SectionHeading id="streams">Streams</SectionHeading>

			<div className="prose">
				<p>
					Raw chain event firehose. Cursor-paginated REST, idempotent,
					replayable. Pull every print, transfer, and contract event at your own
					pace.
				</p>
			</div>

			<Code>{`curl -H "Authorization: Bearer sk-sl_streams_..." \\
  https://api.secondlayer.tools/v1/streams/events?types=print&limit=5`}</Code>

			<div className="prose">
				<p>
					<Link href="/streams">Learn more →</Link>
				</p>
			</div>

			<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

			<div className="prose">
				<p>
					Define a typed schema + handler, deploy, get a queryable REST API
					backed by your own Postgres. Templates ship for SIP-010 balances, sBTC
					flows, PoX-4 stacking, BNS names. From scaffold to first query in 30
					minutes.
				</p>
			</div>

			<Code>{`sl subgraphs new my-watcher --template sip-010-balances
sl subgraphs deploy my-watcher.ts
sl subgraphs query my-watcher transfers --filter recipient=SP1...`}</Code>

			<div className="prose">
				<p>
					<Link href="/subgraphs">Learn more →</Link>
				</p>
			</div>

			<SectionHeading id="subscriptions">Subscriptions</SectionHeading>

			<div className="prose">
				<p>
					Push semantics. Bind a typed filter to a subgraph table — every
					matching row triggers a signed webhook. Inngest, Trigger.dev,
					Cloudflare Workflows, or vanilla Node templates ship with the CLI.
				</p>
			</div>

			<Code>{`import { on } from "@secondlayer/stacks";

await sdk.subscriptions.create({
  ...on.transferTo({ subgraph: "my-watcher", table: "transfers" }, "SP1ABC..."),
  name: "watch",
  url: "https://my-app.com/webhook",
});`}</Code>

			<div className="prose">
				<p>
					<Link href="/subscriptions">Learn more →</Link>
				</p>
			</div>

			<SectionHeading id="datasets">Foundation Datasets</SectionHeading>

			<div className="prose">
				<p>
					Five hosted datasets that cover the canonical event shapes every
					Stacks app needs. Stable schemas, REST APIs, parquet bulk dumps,
					public freshness reporting.{" "}
					<span className="pink">Public goods, free forever.</span>
				</p>
				<ul>
					<li>
						<Link href="/datasets/stx-transfers">STX transfers</Link>
					</li>
					<li>
						<Link href="/datasets/sbtc">sBTC</Link> — deposits, withdrawals,
						SIP-010 movements
					</li>
					<li>
						<Link href="/datasets/pox-4">PoX-4 stacking</Link>
					</li>
					<li>
						<Link href="/datasets/bns">BNS-V2 names</Link>
					</li>
					<li>
						<Link href="/datasets/network-health">Network health</Link>
					</li>
				</ul>
			</div>

			<Code>
				{"curl https://api.secondlayer.tools/v1/datasets/stx-transfers?limit=2"}
			</Code>

			<SectionHeading id="tools">Tools</SectionHeading>

			<div className="prose">
				<p>
					SDK, CLI, MCP server, and the agent-native{" "}
					<code>@secondlayer/stacks</code> chain SDK. Same auth across all of
					them.
				</p>
				<p>
					<Link href="/tools">Learn more →</Link>
				</p>
			</div>

			<SectionHeading id="get-started">Get started</SectionHeading>

			<div className="prose">
				<p>
					<a href="mailto:hi@secondlayer.tools?subject=Launch%20list">
						hi@secondlayer.tools
					</a>{" "}
					for the launch note. Or jump in:
				</p>
			</div>

			<Code>{`bun add -g @secondlayer/cli
sl login
sl subgraphs new my-watcher --template sip-010-balances`}</Code>
		</div>
	);
}
