import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "v1 → v2 migration | secondlayer",
	description:
		"@secondlayer/workflows is deprecated. Subscriptions replace the workflow + sentry pattern with push semantics, Standard Webhooks signing, and a DLQ.",
};

const toc: TocItem[] = [
	{ label: "What changed", href: "#what-changed" },
	{ label: "Mapping", href: "#mapping" },
	{ label: "Translate a workflow", href: "#translate" },
	{ label: "Translate a sentry", href: "#sentry" },
	{ label: "What's no longer supported", href: "#unsupported" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function MigrationPage() {
	return (
		<div className="article-layout">
			<Sidebar title="v1 → v2 migration" toc={toc} />
			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">v1 → v2 migration</h1>
				</header>

				<SectionHeading id="what-changed">What changed</SectionHeading>

				<div className="prose">
					<p>
						<code>@secondlayer/workflows</code>,{" "}
						<code>@secondlayer/workflow-runner</code>, and the sentries package
						are deprecated. Push semantics for chain events live on the new{" "}
						<a href="/docs/subscriptions">Subscriptions</a> product.
					</p>
					<p>
						Durable execution wasn't our edge — Inngest, Trigger.dev, Cloudflare
						Workflows, and Temporal each spent years on it. We ship templates so
						you assemble the runtime you want; we deliver typed, signed events
						into it via Subscriptions.
					</p>
				</div>

				<SectionHeading id="mapping">Mapping</SectionHeading>

				<div className="prose">
					<ul>
						<li>
							<strong>Workflow trigger</strong> → Subscription filter on a
							subgraph table
						</li>
						<li>
							<strong>Workflow steps</strong> → your runtime (Inngest /
							Trigger.dev / Cloudflare / Node) handler
						</li>
						<li>
							<strong>Sentry</strong> → Subscription with a narrow filter + your
							alerting code in the handler
						</li>
						<li>
							<strong>Workflow signer</strong> → AI SDK calls in your handler;{" "}
							<code>@secondlayer/stacks</code> supplies the typed chain SDK
						</li>
						<li>
							<strong>tx_confirmed_notify</strong> → subscribe to your
							subgraph's <code>transactions</code> table with{" "}
							<code>{"{status: 'success'}"}</code>
						</li>
					</ul>
				</div>

				<SectionHeading id="translate">Translate a workflow</SectionHeading>

				<div className="prose">
					<p>Old (v1):</p>
				</div>

				<InlineCodeBlock>
					{`// workflow.ts
import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
  trigger: { contract: "SP1...usdc", event: "transfer" },
  steps: [
    async ({ event }) => {
      if (event.amount < 1_000_000n) return;
      await notify(event.recipient, event.amount);
    },
  ],
});`}
				</InlineCodeBlock>

				<div className="prose">
					<p>New (v2):</p>
				</div>

				<InlineCodeBlock>
					{`// scaffold:  sl create subscription large-usdc --runtime node
// then provision via the SDK or CLI:

import { createClient as sdk } from "@secondlayer/sdk";
import { on } from "@secondlayer/stacks";

await sdk(...).subscriptions.create({
  ...on.sip010Transfer(
    { subgraph: "my-watcher", table: "transfers" },
    "SP1...usdc::usdc-token",
  ),
  filter: { ...on.sip010Transfer(...).filter, amount: { gte: "1000000" } },
  name: "large-usdc",
  url: "https://my-app.com/webhook",
});

// then in your runtime:
export async function POST(req: Request) {
  const body = await req.json();
  if (!verifyStandardWebhooks(req.headers, body, secret)) return new Response(null, { status: 401 });
  await notify(body.event.recipient, body.event.amount);
  return new Response(null, { status: 200 });
}`}
				</InlineCodeBlock>

				<SectionHeading id="sentry">Translate a sentry</SectionHeading>

				<div className="prose">
					<p>
						Sentries were workflow-with-alerting glue. Now they're just
						subscriptions whose handler posts to PagerDuty / Discord / Slack:
					</p>
				</div>

				<InlineCodeBlock>
					{`await sdk(...).subscriptions.create({
  ...on.poxStack(
    { subgraph: "my-pox-monitor", table: "calls" },
    "set-signer-key-authorization",
  ),
  name: "alert-on-signer-rotation",
  url: "https://my-app.com/pagerduty-webhook",
  format: "raw",
});`}
				</InlineCodeBlock>

				<SectionHeading id="unsupported">
					What's no longer supported
				</SectionHeading>

				<div className="prose">
					<ul>
						<li>
							<code>@secondlayer/workflows</code>, <code>workflow-runner</code>,
							<code> sentries</code>, <code> signer-node</code> packages
						</li>
						<li>
							<code>sl workflows *</code> CLI surface
						</li>
						<li>Workflow + sentry dashboard pages</li>
						<li>
							<code>@secondlayer/workflows/ai</code> wrapped-provider package
							(use AI SDK directly + <code>@secondlayer/stacks</code> tools)
						</li>
					</ul>
					<p>
						The deprecated packages remain on npm at their last published
						versions. New work should target Subscriptions.
					</p>
				</div>
			</main>
		</div>
	);
}
