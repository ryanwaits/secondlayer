import { BoxBadge } from "@/components/box-badge";
import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Quick start", href: "#quick-start" },
	{ label: "Verify", href: "#verify" },
	{ label: "Formats", href: "#formats" },
	{ label: "Filters", href: "#filters" },
	{ label: "Retries", href: "#retries" },
];

export default function SubscriptionsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Subscriptions" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Subscriptions <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						A subscription is a typed HTTP webhook sourced from a subgraph
						table. Every row inserted into the table is delivered as a signed
						POST to your URL, with automatic retries and a per-subscription
						circuit breaker. Pick from six wire formats depending on where the
						receiver runs.
					</p>
				</div>

				<SectionHeading id="quick-start">Quick start</SectionHeading>

				<div className="prose">
					<p>
						Scaffold a receiver project with the CLI — it prompts for subgraph,
						table, and URL, then provisions the subscription and writes{" "}
						<code>SIGNING_SECRET</code> into <code>.env</code>.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`sl create subscription whale-alerts --runtime node
# runtimes: node | inngest | trigger | cloudflare`}
				/>

				<div className="prose">
					<p>Or create programmatically via the SDK:</p>
				</div>

				<CodeBlock
					code={`import { SecondLayer } from "@secondlayer/sdk"

const sl = new SecondLayer({ apiKey: process.env.SL_SERVICE_KEY })

const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "token-transfers",
  tableName: "transfers",
  url: "https://example.com/webhooks/sl",
  format: "standard-webhooks", // default
})

// signingSecret is returned ONCE — store it server-side.`}
				/>

				<div className="prose">
					<p>
						The dashboard at <code>/subgraphs/&lt;name&gt;/subscriptions</code>{" "}
						is observe-only — pause, resume, rotate, replay, inspect
						delivery log + dead-letter queue. Creation happens via CLI, SDK,
						or MCP tools; the dashboard never asks you to fill out a form.
					</p>
				</div>

				<SectionHeading id="verify">Verify deliveries</SectionHeading>

				<div className="prose">
					<p>
						Default deliveries are signed per the{" "}
						<a href="https://standardwebhooks.com">Standard Webhooks</a> spec,
						so any Svix verify library works. The shared helper:
					</p>
				</div>

				<CodeBlock
					code={`import { Hono } from "hono"
import { verify } from "@secondlayer/shared/crypto/standard-webhooks"

const app = new Hono()
const secret = process.env.SIGNING_SECRET!

app.post("/webhooks/sl", async (c) => {
  const body = await c.req.text()
  const headers = Object.fromEntries(c.req.raw.headers)
  if (!verify(body, headers, secret)) return c.text("bad signature", 401)

  const { data } = JSON.parse(body) // { type, subgraph, table, row, ... }
  console.log("row inserted:", data.row)
  return c.text("ok")
})`}
				/>

				<SectionHeading id="formats">Formats</SectionHeading>

				<div className="prose">
					<ul>
						<li>
							<code>standard-webhooks</code> (default) — signed POST with{" "}
							<code>webhook-id</code>, <code>webhook-timestamp</code>,{" "}
							<code>webhook-signature</code> headers. Any HTTP receiver.
						</li>
						<li>
							<code>inngest</code> — Inngest events API body (
							<code>{"{ name, data }"}</code>).
						</li>
						<li>
							<code>trigger</code> — Trigger.dev v3 task trigger payload.
						</li>
						<li>
							<code>cloudflare</code> — Cloudflare Workflows instances API
							request.
						</li>
						<li>
							<code>cloudevents</code> — CloudEvents 1.0 structured JSON.
						</li>
						<li>
							<code>raw</code> — bare row JSON with user-controlled{" "}
							<code>authConfig</code> headers.
						</li>
					</ul>
				</div>

				<SectionHeading id="filters">Filters</SectionHeading>

				<div className="prose">
					<p>
						Scalar-only JSON filter, evaluated against each row before delivery.
						Multiple keys AND together; OR is not supported.
					</p>
				</div>

				<CodeBlock
					lang="json"
					code={`{
  "amount": { "gte": 100 },
  "kind":   { "in": ["mint", "burn"] },
  "sender": "SP1ABC..."
}

// Operators: eq, neq, gt, gte, lt, lte, in. Bare values are shorthand for eq.`}
				/>

				<SectionHeading id="retries">Retries & circuit breaker</SectionHeading>

				<div className="prose">
					<p>
						Failed deliveries retry up to 7 times with backoff{" "}
						<code>30s → 2m → 10m → 1h → 6h → 24h → 72h</code>; after that, the
						delivery is marked <code>dead</code>. After 20 consecutive failures,
						the subscription's circuit trips — status flips to{" "}
						<code>paused</code> with <code>circuit_opened_at</code> set, and no
						further rows emit until you resume from the dashboard or call{" "}
						<code>sl.subscriptions.resume(id)</code>. Resuming drains the
						pending backlog.
					</p>
				</div>
			</main>
		</div>
	);
}
