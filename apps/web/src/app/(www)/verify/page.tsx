import { CodeBlock } from "@/components/code-block";
import { CopyButton } from "@/components/copy-button";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Highlight,
	Terminal,
} from "@/components/site";
import { VerifyChainArt } from "@/components/site/assets";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";

const LEDE =
	"Check a block, its transactions and the state it wrote against the chain itself. No trust in secondlayer, or in any node that served the bytes.";

export const metadata: Metadata = socialMeta({
	title: "Verify · secondlayer",
	description: LEDE,
	image: "/og/verify.png",
	path: "/verify",
});

const SDK_SNIPPET = `import {
  SecondlayerProofSource,
  verifyBlock,
} from "@secondlayer/verify";

// No key needed; add apiKey for higher rate limits.
const source = new SecondlayerProofSource({
  baseUrl: "https://api.secondlayer.tools",
});

const result = await verifyBlock(9_137_005, { source });

if (!result.ok) {
  throw new Error(result.failures[0]?.message); // first broken link
}
console.log(result.stateRoot, result.diff?.writes.length);`;

const CHECKS: readonly {
	kind: string;
	title: string;
	cmd: string;
	trusted: string;
}[] = [
	{
		kind: "Block",
		title: "Any height, with its transactions and state",
		cmd: "secondlayer verify block <height>",
		trusted: "the checkpoint in the release",
	},
	{
		kind: "Transaction",
		title: "It's in the block, and the signers signed it",
		cmd: "GET /v1/index/transactions/:id/proof",
		trusted: "the signer set, unless you pass your node's",
	},
	{
		kind: "State writes",
		title: "Every key a block wrote, named and proven",
		cmd: "GET /v1/proofs/writes/:height",
		trusted: "the checkpoint",
	},
	{
		kind: "Archive",
		title: "Your history against the signed manifest",
		cmd: "secondlayer verify raw --against latest.json",
		trusted: "the archive signing key. Checking is free; repair is paid.",
	},
	{
		kind: "Subgraph rows",
		title: "Recompute a state subgraph and compare",
		cmd: "secondlayer verify subgraph <name> --replay",
		trusted: "the checkpoint. State subgraphs only.",
	},
	{
		kind: "Deliveries",
		title: "Streams frames and webhooks are signed",
		cmd: "verifyWebhookSignature(body, headers)",
		trusted: "the key. Proves who sent it, not that the chain agrees.",
	},
];

const GAPS: readonly { name: string; why: string }[] = [
	{
		name: "Print events",
		why: "Stacks headers don't commit to them, so no block check covers them.",
	},
	{
		name: "Transaction results",
		why: "Same reason. Whether a call succeeded isn't in the header.",
	},
	{
		name: "Which tx made a write",
		why: "The tx root binds each transaction's bytes, not which one wrote a leaf.",
	},
	{
		name: "Bitcoin reorgs",
		why: "Headers are checked for valid work, not against a competing chain.",
	},
	{
		name: "Other subgraphs",
		why: "Only state subgraphs replay. Event subgraphs don't, yet.",
	},
];

const LADDER: readonly {
	n: string;
	name: string;
	body: string;
	state?: "here" | "soon";
}[] = [
	{
		n: "01",
		name: "Decoded",
		body: "Every Stacks block, from genesis, delivered at tip.",
	},
	{
		n: "02",
		name: "Signed",
		body: "Archive manifests, Streams frames and webhooks carry ed25519 signatures.",
	},
	{
		n: "03",
		name: "Checkable",
		body: "Blocks, state writes and state-subgraph rows prove against the chain.",
		state: "here",
	},
	{
		n: "04",
		name: "Every write, named",
		body: "Inner contract calls and writes that never print, with the tx that made them.",
		state: "soon",
	},
];

const ROUTES: readonly { route: string; returns: string }[] = [
	{
		route: "/v1/proofs/block/height/:height",
		returns: "Signed block by height",
	},
	{
		route: "/v1/proofs/witness/:index_block_hash",
		returns: "State witness the header's state root must hash to",
	},
	{
		route: "/v1/proofs/writes/:height",
		returns: "Every leaf the block wrote, named",
	},
	{
		route: "/v1/proofs/marf/:path",
		returns: "MARF inclusion proof for a key at a block",
	},
	{
		route: "/v1/proofs/burn/:consensus_hash",
		returns: "Burn block a consensus hash commits to",
	},
	{
		route: "/v1/proofs/bitcoin-headers",
		returns: "Raw Bitcoin headers from a height",
	},
];

export default function VerifyPage() {
	return (
		<main className="site verify">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun="Verify" />
						<h1>
							An index <Highlight>you can check,</Highlight> not one you have to
							trust.
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="#check">Verify a block</ButtonLink>
							<ButtonLink href="/docs/verification" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<p className="cap">
							Proofs are free · no key needed · @secondlayer/verify on npm
						</p>
					</div>
					<Terminal title="~/app" meta="example output · mainnet">
						<pre>
							<span className="t-a">{"❯"}</span>
							{" secondlayer verify block 9137005\n"}
							<span className="t-ok">{"✓"}</span>
							{" block       9,137,005  "}
							<span className="t-m">{"2e5962b0…92f57ff"}</span>
							{"\n"}
							<span className="t-ok">{"✓"}</span>
							{" bitcoin     headers 967,680..970,269, proof of work checked\n"}
							<span className="t-ok">{"✓"}</span>
							{" burn        height 970,269\n"}
							<span className="t-ok">{"✓"}</span>
							{" cycle       144, signer set proven from cycle 143\n"}
							<span className="t-ok">{"✓"}</span>
							{" signatures  2,866 / 4,000 weight, threshold 2,800\n"}
							<span className="t-ok">{"✓"}</span>
							{" txs         2 transactions match the tx merkle root\n"}
							<span className="t-ok">{"✓"}</span>
							{" state root  8103be4b…191f0cd5 matches the witness\n"}
							<span className="t-ok">{"✓"}</span>
							{" diff        18 written, 1 carried, 5 internal\n"}
							<span className="t-m">{"·"}</span>
							<span className="t-m">
								{" rows        not checked (pass --rows)"}
							</span>
							{"\n"}
							<span className="fin">
								<span className="t-ok">{"✓"}</span>
								{" Block 9,137,005 is proven. Trusted: only the checkpoint."}
							</span>
						</pre>
						<div className="exits">
							<span>
								<b>exit 0</b> every link holds
							</span>
							<span>
								<b>1</b> first broken link, named
							</span>
							<span>
								<b>2</b> could not check
							</span>
						</div>
					</Terminal>
				</div>
			</div>

			<div className="band band-ruled" id="chain">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="The chain of trust" />
						<h2>One command walks every link, from Bitcoin to your row.</h2>
						<p className="lede">
							A lying source can make a link fail. It can never make one pass.
						</p>
					</div>
					<VerifyChainArt />
					<p className="cap chain-eg">
						example checkpoint, shown for illustration
					</p>
					<div className="chain-note">
						<span>
							<b>Below the checkpoint</b>, the block hash-chains to it: parent
							links, or one MARF proof.
						</span>
						<span>
							<b>Free</b> by default. <span className="mono">--rows</span> also
							checks indexed rows, billed as Index rows.
						</span>
					</div>
				</div>
			</div>

			<div className="band band-ruled" id="check">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="What you can check today" />
						<h2>Every answer we can prove ships with its proof.</h2>
						<p className="lede">
							A hash, a merkle path, a signature, or a replay you run yourself.
							Each one names what you still trust.
						</p>
					</div>
					<div className="checks">
						{CHECKS.map((c) => (
							<div className="check" key={c.kind}>
								<span className="k">
									<i />
									{c.kind}
								</span>
								<h3>{c.title}</h3>
								<code>{c.cmd}</code>
								<p className="trust">
									<b>Still trusted:</b> {c.trusted}
								</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band band-ruled" id="limits">
				<div className="shell limits">
					<div className="rule">
						<Eyebrow noun="What it does not cover yet" />
						<p>
							A check that passes leaves you trusting a smaller, named thing.
						</p>
						<p>A check that can't run says so, and is never a pass.</p>
					</div>
					<div>
						<div className="gaps">
							{GAPS.map((g) => (
								<div className="gap" key={g.name}>
									<b>{g.name}</b>
									<span>{g.why}</span>
								</div>
							))}
						</div>
						<div className="trusted">
							<Eyebrow noun="What you still trust" />
							<div className="chips">
								{[
									"example checkpoint · Stacks 8,956,304",
									"archive signing key",
									"webhook signing key",
								].map((c) => (
									<span className="chip dash" key={c}>
										{c}
									</span>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="band band-ruled" id="ladder">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="How far it goes" />
						<h2>Each step trusts less than the one before.</h2>
					</div>
					<div className="ladder">
						{LADDER.map((r) => (
							<div className={r.state ? `rung ${r.state}` : "rung"} key={r.n}>
								<span className="step">
									{r.n}
									{r.state === "here" ? <b>today</b> : null}
									{r.state === "soon" ? " · coming" : null}
								</span>
								<h3>{r.name}</h3>
								<p>{r.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band band-ruled" id="sdk">
				<div className="shell sdk">
					<div>
						<div className="sec-head" style={{ marginBottom: 0 }}>
							<Eyebrow noun="In your code" />
							<h2>The same check, as a library.</h2>
							<p className="lede">
								Gate a payout, a bridge release or an alert on a block you
								proved yourself.
							</p>
						</div>
						<ul>
							<li>
								<span>
									<b>Never throws on bad data.</b> Returns{" "}
									<span className="mono">ok: false</span> and the first broken
									link.
								</span>
							</li>
							<li>
								<span>
									<b>Bring your own node.</b> Blocks and MARF proofs come from
									its RPC; the rest is checked the same way.
								</span>
							</li>
							<li>
								<span>
									<b>Runs anywhere.</b> <span className="mono">fetch</span> and
									pure-JS crypto, no Node built-ins.
								</span>
							</li>
							<li>
								<span>
									<b>Proofs are never billed.</b> No key needed; add one for
									higher rate limits.
								</span>
							</li>
						</ul>
					</div>
					<div className="sdk-code">
						<Terminal title="verify.ts" meta="bun add @secondlayer/verify">
							<CodeBlock code={SDK_SNIPPET} lang="typescript" />
						</Terminal>
						<p className="cap">example block height</p>
					</div>
				</div>
			</div>

			<div className="band band-ruled" id="api">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Proofs API" />
						<h2>The raw material, free.</h2>
						<p className="lede">
							What <span className="mono">verify block</span> reads. Fetch it
							yourself and check it however you like.
						</p>
					</div>
					<div className="tblwrap proofs">
						<table>
							<thead>
								<tr>
									<th>Route</th>
									<th>Returns</th>
								</tr>
							</thead>
							<tbody>
								{ROUTES.map((r) => (
									<tr key={r.route}>
										<td>{r.route}</td>
										<td>{r.returns}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="chips">
						<span className="chip">never metered</span>
						<span className="chip">no key needed</span>
						<span className="chip">10 req/s per IP (20 with a key)</span>
						<span className="chip">1 req/s for witnesses (2 with a key)</span>
						<span className="chip dash">
							self-host: needs the proof sidecar
						</span>
					</div>
				</div>
			</div>

			<CloseBand
				title="Check a block before you trust it."
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/docs/verification" variant="secondary">
							Read the Verify docs
						</ButtonLink>
					</>
				}
				caption={
					<>
						<span className="cmd">
							<code>secondlayer verify block 9137005</code>
							<CopyButton
								code="secondlayer verify block 9137005"
								label="Copy"
							/>
						</span>
						<span className="cap">
							any block height or index_block_hash works
						</span>
					</>
				}
			/>
		</main>
	);
}
