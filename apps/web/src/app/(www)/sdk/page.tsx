import { CodeBlock } from "@/components/code-block";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "SDK | secondlayer",
	description:
		"TypeScript clients for the data plane and the chain — @secondlayer/sdk and the agent-native @secondlayer/stacks chain SDK.",
};

export default function SdkPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader crumb="Home" crumbHref="/" here="SDK" title="SDK" />
			<div className="mk-body">
				<div className="prose">
					<p>
						Two TypeScript packages. <code>@secondlayer/sdk</code> talks to the
						data plane — Streams, Subgraphs, Subscriptions, Index — with
						programmatic parity to the <Link href="/cli">CLI</Link>.{" "}
						<code>@secondlayer/stacks</code> is the agent-native chain SDK:
						typed contract reads and writes, AI SDK tool values, and the filter
						factories that produce typed Subscription specs.
					</p>
				</div>

				<SectionHeading id="sdk">@secondlayer/sdk</SectionHeading>

				<div className="prose">
					<p>
						The data-plane client. Query the decoded Index, read Streams, deploy
						subgraphs and query their tables, manage row-change webhooks — all
						from one typed package.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={"bun add @secondlayer/sdk @secondlayer/stacks"}
				/>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer, createStreamsClient } from "@secondlayer/sdk";

const client = new SecondLayer({ apiKey: process.env.SL_API_KEY! });

// Decoded events, queryable — no indexer to run.
const { events } = await client.index.events({ eventType: "stx_transfer", limit: 25 });

await client.subgraphs.queryTable("my-watcher", "transfers", { limit: 10 });
await client.subscriptions.create({ ... });

const streams = createStreamsClient({ apiKey: process.env.SL_API_KEY! });
await streams.events.consume({ types: ["print"], onBatch: async (events) => { ... } });`}
				/>

				<SectionHeading id="stacks">@secondlayer/stacks</SectionHeading>

				<div className="prose">
					<p>
						The agent-native Stacks chain SDK. Typed contract reads + writes, AI
						SDK <code>tool({"{...}"})</code> values, and the <code>on.*</code>{" "}
						filter factories that produce typed{" "}
						<Link href="/subscriptions">Subscription</Link> specs.
					</p>
				</div>

				<CodeBlock lang="bash" code={"bun add @secondlayer/stacks"} />

				<CodeBlock
					lang="typescript"
					code={`import { on } from "@secondlayer/stacks";

// Typed subscription filter — bind to a subgraph table you own.
const spec = on.transferTo(
  { subgraph: "my-watcher", table: "transfers" },
  "SP1ABC...",
  { asset: "SP1...usdc::usdc-token" },
);

// Available: on.transferTo, on.sip010Transfer, on.sip009Transfer,
//            on.bnsName, on.poxStack, on.sbtcDeposit, on.sbtcWithdrawal`}
				/>
			</div>
		</main>
	);
}
