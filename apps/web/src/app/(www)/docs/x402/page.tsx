import { CodeBlock } from "@/components/code-block";
import type { Metadata } from "next";
import Link from "next/link";
import { X402Steps } from "./x402-steps";

export const metadata: Metadata = {
	title: "x402 pay-per-call (experimental) — Secondlayer",
	description:
		"Agents pay per call with x402 — HTTP 402 quotes settled on Stacks. Experimental beta.",
};

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

export default function X402DocsPage() {
	return (
		<article className="prose">
			<p
				style={{
					border: "1px dashed var(--rule, #bbb)",
					padding: "0.6rem 0.9rem",
					fontSize: "0.85em",
				}}
			>
				<strong>Experimental.</strong> The pay-per-call rail is a beta — surfaces,
				prices, and headers may change. Plans on the{" "}
				<Link href="/pricing">pricing page</Link> are the stable way to pay.
			</p>

			<h1>x402 pay-per-call</h1>

			<p>
				Built for agents. Index and Streams reads (<code>/v1/index</code>,{" "}
				<code>/v1/streams</code>) can be paid with <strong>x402</strong>, the
				HTTP 402 payment standard, settled on Stacks — and a paid{" "}
				<code>POST /v1/subgraphs</code> deploys an indexer owned by your wallet.
				No card, no signup, no gas: transfers are sponsored, you only hold the
				token (sBTC, STX, or USDCx).
			</p>

			<h2>How it works</h2>

			<X402Steps
				panes={[
					<CodeBlock key="quote" code={X402_QUOTE} lang="bash" />,
					<CodeBlock key="client" code={X402_CLIENT} lang="typescript" />,
					<CodeBlock key="retry" code={X402_RETRY} lang="bash" />,
					<CodeBlock key="receipt" code={X402_RECEIPT} lang="typescript" />,
				]}
			/>

			<p>
				Standard x402 v2 wire — works with any x402 client. Sponsored means we
				pay the STX gas. Discovery:{" "}
				<code>GET /.well-known/x402</code> and the <code>x-x402</code> block in{" "}
				<a href="https://api.secondlayer.tools/v1/openapi.json">
					the OpenAPI spec
				</a>
				. Steady consumers can hold a session (one payment covers up to 500
				polls an hour) or a prepaid tab (deposit once, calls debit it
				instantly).
			</p>
		</article>
	);
}
