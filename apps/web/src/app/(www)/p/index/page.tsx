import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	LiveEventsOdometer,
	Manifest,
	Meters,
	Props,
	RestOfPlatform,
	SelfHostSlot,
	Split,
	StatusDot,
	Terminal,
} from "@/components/site";
import { IndexHero } from "@/components/site/assets";
import {
	formatCount,
	getLiveEvents,
	getSignedCounts,
	manifestRows,
} from "@/lib/chain-stats";
import { socialMeta } from "@/lib/og";
import { GITHUB_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

const LEDE =
	"Every Stacks event from genesis, typed and paginated behind one key. Checkable against a signed manifest.";

export const metadata: Metadata = socialMeta({
	title: "Index · secondlayer",
	description: LEDE,
	image: "/og/index.png",
	path: "/p/index",
});

const [, , index] = PRODUCTS;

const EVENT_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
] as const;

const DATASETS: readonly {
	status: "live" | "soon" | "rolling";
	name: string;
	body: string;
	example: readonly [string, string];
}[] = [
	{
		status: "live",
		name: "PoX-5",
		body: "Stacking prints by signer and cycle. The print log, not a position scoreboard.",
		example: ["stack-aggregation-commit", "cycle 118 · signer 02a1…7f"],
	},
	{
		status: "live",
		name: "sBTC",
		body: "Deposits in and withdrawals out, each tied to its Bitcoin transaction.",
		example: ["deposit · 0.25 BTC", "btc tx 7c1e…a0 · confirmed"],
	},
	{
		status: "soon",
		name: "Contract state writes",
		body: "Every var and map a contract committed, keyed, including contracts that never print.",
		example: ["map_set · balances", "key SP3F…Q9A → u2500000"],
	},
	{
		status: "rolling",
		name: "Runes",
		body: "Etchings, mints and balances from block 840,000, checked against ord with 0 mismatches.",
		example: ["mint · UNCOMMON•GOODS", "height 968,557 · amount 1"],
	},
];

export default async function IndexPage() {
	const signed = await getSignedCounts();
	const liveEvents = await getLiveEvents(signed);
	const toBlock = formatCount(signed.toBlock);
	const blocks = formatCount(signed.blocks);
	return (
		<main className="site product">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={index.noun} verb={index.verb} />
						<h1>
							The whole chain, <Highlight>already decoded</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/login">Query the index</ButtonLink>
							<ButtonLink href="/docs/index" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<LiveEventsOdometer initial={liveEvents} label="events decoded" />
					</div>
					<div className="hero-art">
						<IndexHero />
					</div>
				</div>

				<Props
					items={[
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
									<path d="M2.5 7.8h15M2.5 12h15" />
								</svg>
							),
							title: "No schema decisions up front",
							body: "Filter events by type, contract, sender or recipient before you commit to a table shape.",
						},
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<circle cx="10" cy="10" r="6.5" />
									<path d="M10 6.2V10l2.8 1.8" />
								</svg>
							),
							title: "Finality is in the envelope",
							body: "Every page reports the tip, the finalized height and any reorg that crossed your cursor.",
						},
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<path d="M10 2.6 16.5 6v5.2c0 3-2.8 5.2-6.5 6.2-3.7-1-6.5-3.2-6.5-6.2V6z" />
									<path d="M7.4 10.2 9.4 12l3.4-3.6" />
								</svg>
							),
							title: "You can audit the whole set",
							body: "Coverage, row counts and a digest are published and signed. Checking your copy costs nothing.",
						},
					]}
				/>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<Split
						copy={
							<>
								<Eyebrow noun="The read" />
								<h2>One envelope, everywhere</h2>
								<p className="lede">
									Cursor, tip and reorgs come back on every list, in the same
									shape a subgraph read returns. One reader covers both.
								</p>
							</>
						}
						art={
							<Terminal title="GET /v1/index/events">
								<pre>
									<span className="t-m">{"❯ "}</span>
									<span className="t-a">curl</span>
									{
										' "$SL/v1/index/events?event_type=ft_transfer&limit=20" \\\n    -H "authorization: Bearer sk-sl_…"\n\n'
									}
									<span className="t-m">{"{"}</span>
									{
										'\n  "events": [{ "block_height": 8948506, "event_index": 12,\n               "type": "ft_transfer", … }],\n  "next_cursor": '
									}
									<span className="t-a">{'"8948506:12"'}</span>
									{
										',\n  "tip": { "block_height": 8948506, "finalized_height": 8948262 },\n  "reorgs": []\n'
									}
									<span className="t-m">{"}"}</span>
								</pre>
							</Terminal>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="The signed set" />
								<h2>Checking us is free, forever</h2>
								<p className="lede">
									The canonical set is published as one signed manifest:
									coverage, counts, a digest and the finality rule. Check your
									own database against it read-only, as often as you like, and
									repair only what is broken.
								</p>
							</>
						}
						art={
							<Terminal title="~/instance">
								<pre>
									<span className="t-m">{"❯ "}</span>
									<span className="t-a">secondlayer verify</span>
									{
										" all \\\n    --against https://archive.secondlayer.tools/latest.json\n"
									}
									<span className="t-m">
										{"  manifest    secondlayer-canonical v1 · mainnet"}
									</span>
									{"\n"}
									<span className="t-m">
										{`  coverage    0 → ${toBlock}   (${blocks} blocks)`}
									</span>
									{"\n"}
									<span className="t-hit">
										{"  ✓ 0 broken ranges · 0 gaps · nothing uploaded"}
									</span>
									{"\n"}
									<span className="t-m">{"❯ "}</span>
									<span className="t-a">secondlayer repair</span>
									{
										" --apply \\\n    --against https://archive.secondlayer.tools/latest.json\n"
									}
									<span className="t-m">
										{"  planned     3 partitions · events"}
									</span>
									{"\n"}
									<span className="t-m">{"  allowance   "}</span>
									<span className="t-a">
										{"15 of 18 free partitions left this month"}
									</span>
									{"\n"}
									<span className="t-hit">{"  ✓ charged $0.00"}</span>
								</pre>
							</Terminal>
						}
					/>

					<Manifest
						title="secondlayer-canonical · v1 · mainnet"
						rows={manifestRows(signed)}
					/>

					<Meters
						items={[
							{
								label: "Volume meter",
								value: "$5 / 1M rows",
								body: "Rows delivered, dropping to $2 per 1M past $50 of monthly spend. Filters cut the bill along with the output.",
							},
							{
								label: "Free every month",
								value: "1M rows",
								body: "Plus block headers and every verify, on any account. Reading the index stores nothing, so there is no capacity charge.",
							},
						]}
					/>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Decoded datasets" />
						<h2>Data nobody else decodes</h2>
						<p className="lede">
							Same rows, same price as any other event. Each one says exactly
							what it covers.
						</p>
					</div>
					<div className="decodes">
						{DATASETS.map((d) => (
							<div className="dc" key={d.name}>
								<StatusDot state={d.status} />
								<h3>{d.name}</h3>
								<p>{d.body}</p>
								<div className="ex">
									<span>example</span>
									{`\n${d.example[0]}\n${d.example[1]}`}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Coverage" />
						<h2>Thirteen event types, every contract</h2>
						<p className="lede">
							Scope any of them to one contract, a set of up to twenty, a trait,
							or the addresses a factory deployed.
						</p>
					</div>
					<div className="types">
						{EVENT_TYPES.map((t) => (
							<span key={t}>{t}</span>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Built on this index" />
						<h2>
							They read the same index. The difference is who holds the state.
						</h2>
					</div>
					<RestOfPlatform
						exclude={["/p/index", "/p/archive"]}
						blurbs={{
							"/p/streams": {
								title: "You hold the cursor",
								body: "Best when you already run a sink and a supervisor, and want no state on our side.",
							},
							"/p/subgraphs": {
								title: "We hold the table",
								body: "Best when the shape is settled and you would rather read a computed table than rebuild it on every boot.",
							},
							"/p/webhooks": {
								title: "We hold the retry queue",
								body: "Best when you want chain events pushed to your server, with failed deliveries logged and requeueable.",
							},
						}}
					/>
				</div>
			</div>

			<SelfHostSlot
				refs={
					<>
						<Link href="/docs/self-host">docs/self-host</Link>
						<a href={GITHUB_URL}>GitHub</a>
					</>
				}
			>
				Hosted is <span className="mono">api.secondlayer.tools</span>. Point{" "}
				<span className="mono">SECONDLAYER_API_URL</span> at your own instance
				and the same CLI, SDK and <span className="mono">/v1</span> routes
				answer. Reads over loopback need no key.{" "}
				<span className="mono">bootstrap</span> stands a fresh box up from the
				same signed partitions instead of replaying the chain.
			</SelfHostSlot>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<h2>Index questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "How do I know the history is complete?",
								a: (
									<>
										The manifest publishes coverage (0 → {toBlock}) and a block
										count ({blocks}). Count equals span, so there is no room for
										a gap. <code>secondlayer verify</code> checks your own copy
										against the signed document for free.
									</>
								),
							},
							{
								q: 'What does "assurance: db-reconstructive" mean?',
								a: "It states what the archive can rebuild: the database as the indexer wrote it, rather than a re-derivation from a node. The strength of the claim is published next to the claim.",
							},
							{
								q: "When is a block final?",
								a: "At six Bitcoin confirmations. Every response carries the current tip and finalized height, so you can treat anything above the finalized height as provisional.",
							},
							{
								q: "How is it billed?",
								a: "By rows delivered. $5 per 1M, then $2 per 1M past $50 of monthly spend. The first 1M rows each month are free, and so are block headers and verification. No seats, no plans.",
							},
							{
								q: "Should I use the index or a subgraph?",
								a: "The index while you are exploring, a subgraph once you know the shape. Reading your own subgraph tables is free; the index bills the rows it delivers.",
							},
						]}
					/>
				</div>
			</div>

			<CloseBand
				title={
					<>
						Read your first decoded event <Highlight>today</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/docs/index" variant="secondary">
							Read the docs
						</ButtonLink>
					</>
				}
			/>
		</main>
	);
}
