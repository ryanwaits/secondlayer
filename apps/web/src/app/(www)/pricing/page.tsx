import { CodeBlock } from "@/components/code-block";
import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { X402Steps } from "./x402-steps";

export const metadata: Metadata = {
	title: "Pricing · secondlayer",
	description:
		"Free is the product, paid is the headroom. Rate-limited public reads for everyone, a permanent free tier, and x402 pay-per-call for agents without accounts.",
};

const FREE_INCLUDES = [
	"Public reads on Index (no key needed) and Streams (with a free ghost key) — rate-limited either way",
	"Ghost keys: curl -X POST /v1/keys, no signup, claim with an email within 30 days",
	"2 public subgraphs — live indexing from the moment you deploy",
	"3 webhook subscriptions, 24h delivery log",
	"Signed Streams bulk dumps for cold-lane replay",
	"MCP server + agent skills",
	"Community support",
];

const PAID_TIERS = [
	{
		name: "Pro",
		price: "$99",
		per: "/mo",
		hot: true,
		summary:
			"100 req/s · 10 subgraphs incl. private · genesis backfills · 25 subscriptions, 7d log + replay · usage budgets · email support",
	},
	{
		name: "Scale",
		price: "$499",
		per: "/mo",
		hot: false,
		summary:
			"500 req/s · 50 subgraphs incl. private · genesis backfills, dedicated lane · unlimited subscriptions, 30d log · team roles + shared projects · Slack support, 99.9% target",
	},
	{
		name: "Enterprise",
		price: "Contact us",
		per: "",
		hot: false,
		summary:
			"Custom rates + dedicated capacity · priority indexing for your contracts · BYO database plane · SLA + incident channel · invoicing + security review",
	},
];

const FAQ = [
	{
		q: "What stays free forever?",
		a: "Rate-limited public reads — anonymous on Index, with a free key on Streams — plus signed bulk dumps and the free tier above. Public data stays public.",
	},
	{
		q: "What does a paid plan actually buy?",
		a: "Capacity and guarantees: a bigger request budget under your own key, more subgraphs (including private ones), full genesis backfills instead of forward-only indexing, longer webhook retention, support and SLAs. Never access to public data.",
	},
	{
		q: "Can an agent deploy without an account?",
		a: "Yes, when the pay-per-call rail is on: POST /v1/subgraphs with an x402 payment ($2) deploys a subgraph owned by the paying wallet — live indexing from deploy, renewable for $0.50 a week, expiring if abandoned. Claiming the account later makes it permanent.",
	},
	{
		q: "When does billing start?",
		a: "When open beta ends, with notice. Usage dashboards ship first, so you can see exactly where you'd land before a card is ever involved.",
	},
	{
		q: "x402 or a subscription?",
		a: "x402 suits agents and spiky, accountless workloads: pay exactly per call, with Streams sessions (one payment covers up to 500 polls an hour) and a prepaid tab (deposit once, calls debit it instantly — agents can even top themselves up) keeping steady consumers cheap and fast. Plans suit sustained workloads. They mix freely; a keyed app can still let its agents pay per call.",
	},
];

const X402_QUOTE = `# your agent calls like anyone else…
GET /v1/index/events?event_type=ft_transfer

# …and, with the pay-per-call rail on, gets a quote
HTTP/1.1 402 Payment Required
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "stacks:1",
    "asset": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    "amount": "21",
    "payTo": "SP2X…8KQ",
    "maxTimeoutSeconds": 60,
    "extra": { "nonce": "…" }
  }]
}`;

const X402_CLIENT = `// the code you actually write
import { withX402, readX402Receipt } from "@secondlayer/sdk";

const x402fetch = withX402(fetch, { account });

const res = await x402fetch(
  "https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer",
);
// offer selection, sponsored signing, and the
// retry all happen inside that one call`;

const X402_RETRY = `# what went over the wire for you
GET /v1/index/events?event_type=ft_transfer
PAYMENT-SIGNATURE: eyJzaWduZWQi…

# data streams back immediately
HTTP/1.1 200 OK
{ "events": [ … ], "next_cursor": "7978231:42" }`;

const X402_RECEIPT = `// verify what you paid, in code
const receipt = readX402Receipt(res);
// {
//   success: true,
//   state: "optimistic" | "confirmed",
//   txid: "0x4f…",
//   payer: "SP1Q4…2MVE",
//   network: "stacks:1"
// }`;

export default function PricingPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				crumb="Home"
				crumbHref="/"
				here="Pricing"
				title={
					<>
						Free is the product.
						<br />
						Paid is the headroom.
					</>
				}
			>
				Public reads are rate-limited for everyone, the free tier is permanent,
				and agents without accounts can pay per call. Paid plans buy capacity
				and guarantees, never access to public data.
			</MarketingPageHeader>

			<div className="prc-beta">
				<span className="b">Open beta</span>
				<p>
					Nothing is charged today — everything below is{" "}
					<strong>$0 until beta ends</strong>. Plans show what billing will look
					like.
				</p>
			</div>

			<div className="prc-split">
				<div className="prc-free">
					<span className="prc-stamp" aria-hidden="true">
						forever!
					</span>
					<h3>Free</h3>
					<p className="prc-free-price">$0</p>
					<ul>
						{FREE_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/" className="auth-bar-cta prc-free-cta">
						Mint a key
					</Link>
				</div>
				<div className="prc-paid">
					{PAID_TIERS.map((t) => (
						<div className={`prc-tier${t.hot ? " hot" : ""}`} key={t.name}>
							<div>
								<p className="n">{t.name}</p>
								<p className="d">{t.summary}</p>
							</div>
							<p className="pr">
								{t.price}
								{t.per && <small>{t.per}</small>}
							</p>
						</div>
					))}
					<a className="prc-xjump" href="#pay-per-call">
						<span>⚡ Pay per call</span>
						<p>
							Agents skip plans entirely: 402 quote, sponsored transfer,
							receipt. $0.001 floor — see how it works ↓
						</p>
					</a>
				</div>
			</div>

			<h2 className="prc-h2" id="pay-per-call">
				No account? Pay per call.
			</h2>
			<p className="prc-sub">
				Built for agents. Index and Streams reads (/v1/index, /v1/streams) can
				be paid with <strong>x402</strong>, the HTTP 402 payment standard,
				settled on Stacks — and a paid <strong>POST /v1/subgraphs</strong>{" "}
				deploys an indexer owned by your wallet. No card, no signup, no gas:
				transfers are sponsored, you only hold the token.
			</p>
			<div className="prc-x">
				<div className="prc-x-head">
					<span className="t">How x402 billing works</span>
					<div className="chips">
						<span>sBTC</span>
						<span>STX</span>
						<span>USDCx</span>
					</div>
				</div>
				<X402Steps
					panes={[
						<CodeBlock key="quote" code={X402_QUOTE} lang="bash" />,
						<CodeBlock key="client" code={X402_CLIENT} lang="typescript" />,
						<CodeBlock key="retry" code={X402_RETRY} lang="bash" />,
						<CodeBlock key="receipt" code={X402_RECEIPT} lang="typescript" />,
					]}
				/>
				<div className="prc-x-foot">
					<span>standard x402 v2 wire · works with any x402 client</span>
					<span>sponsored = we pay the STX gas</span>
				</div>
			</div>

			<h2 className="prc-h2">The fine print, up front.</h2>
			<div className="prc-faq">
				{FAQ.map((f) => (
					<div className="qa" key={f.q}>
						<h5>{f.q}</h5>
						<p>{f.a}</p>
					</div>
				))}
			</div>

			<div className="prc-fin">
				<h2 className="prc-h2" style={{ marginTop: 0 }}>
					Start free. Decide later.
				</h2>
				<div className="home-ctas">
					<CtaPill />
				</div>
			</div>
		</main>
	);
}
