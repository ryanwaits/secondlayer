import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "v1 → v2 migration | secondlayer",
	description:
		"@secondlayer/workflows is deprecated. Subscriptions replace the workflow + sentry pattern.",
};

const toc: TocItem[] = [
	{ label: "Mapping", href: "#mapping" },
	{ label: "Translate", href: "#translate" },
	{ label: "Removed", href: "#removed" },
];

export default function MigrationPage() {
	return (
		<div className="article-layout">
			<Sidebar title="v1 → v2" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">v1 → v2 migration</h1>
				</header>

				<div className="prose">
					<p>
						<code>@secondlayer/workflows</code>, <code>workflow-runner</code>,
						and <code>sentries</code> are deprecated. Push semantics for chain
						events live on <Link href="/subscriptions">Subscriptions</Link>.
						Durable execution isn't our edge — Inngest, Trigger.dev, and
						Cloudflare Workflows already nailed it. We deliver typed signed
						events into your runtime.
					</p>
				</div>

				<SectionHeading id="mapping">Mapping</SectionHeading>

				<CodeBlock
					code={`workflow trigger          → Subscription filter on a subgraph table
workflow steps            → your runtime handler (inngest/trigger/cloudflare/node)
sentry                    → Subscription with a narrow filter + your alerting code
workflow signer           → AI SDK calls + @secondlayer/stacks for chain ops
tx_confirmed_notify       → subscribe to your subgraph's transactions table`}
					lang="text"
				/>

				<SectionHeading id="translate">Translate</SectionHeading>

				<CodeBlock
					code={`// v1 (deprecated)
import { defineWorkflow } from "@secondlayer/workflows";
export default defineWorkflow({
  trigger: { contract: "SP1...usdc", event: "transfer" },
  steps: [async ({ event }) => {
    if (event.amount < 1_000_000n) return;
    await notify(event.recipient, event.amount);
  }],
});

// v2
// 1. sl subscriptions create large-usdc --runtime node
// 2. provision the subscription:
import { on } from "@secondlayer/stacks";
await sdk.subscriptions.create({
  ...on.sip010Transfer({ subgraph: "mine", table: "transfers" }, "SP1...usdc::usdc-token"),
  filter: { amount: { gte: "1000000" } },
  name: "large-usdc",
  url: "https://my-app.com/webhook",
});
// 3. handler in your runtime verifies the standard-webhooks signature
//    and acts on the typed payload.`}
				/>

				<SectionHeading id="removed">Removed</SectionHeading>

				<CodeBlock
					code={`@secondlayer/workflows         — gone
@secondlayer/workflow-runner   — gone
@secondlayer/sentries          — gone
@secondlayer/signer-node       — gone
@secondlayer/workflows/ai      — gone (use AI SDK + @secondlayer/stacks tools)
sl workflows *                 — removed CLI surface
/platform/workflows, /platform/sentries  — removed dashboard pages`}
					lang="text"
				/>
			</main>
		</div>
	);
}
