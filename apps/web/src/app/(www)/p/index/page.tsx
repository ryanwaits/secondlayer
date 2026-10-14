import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	LiveEventsOdometer,
	Manifest,
	Meters,
	Ownership,
	Props,
	RestOfPlatform,
	SelfHostSlot,
	Split,
	StatusDot,
} from "@/components/site";
import { IndexHero } from "@/components/site/assets";
import { FilterIcon, MailIcon, ShieldCheckIcon } from "@/components/site/icons";
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
	"Write an indexer against every Stacks event since genesis, in one TypeScript file. Run it on Railway, Render, Fly or your own box. We meter the rows it reads.";

export const metadata: Metadata = socialMeta({
	title: "Index · secondlayer",
	description: LEDE,
	image: "/og/index.png",
	path: "/p/index",
});

const [, , index] = PRODUCTS;

const INDEXER = `import { SecondLayer } from "@secondlayer/sdk";
import { kyselySink } from "@secondlayer/sdk/sinks/kysely";
import { database } from "./database";

const secondlayer = new SecondLayer();

// !callout[/consume/] genesis first, then the tip
await secondlayer.index.events.consume({
  eventType: "ft_transfer",
  contractId: "SM3V…sbtc-token",
  fromHeight: 0,
  sink: kyselySink(database, {
    id: "sbtc-transfers",
    // !callout[/"transfers"/] rolled back on a reorg
    tables: ["transfers"],
    height: "height",
  }),
  onBatch: async (transfers, _envelope, ctx) => {
    // !callout[/ctx\\.tx/] rows + checkpoint, one commit
    await ctx.tx.insertInto("transfers")
      .values(transfers.map(toRow)).execute();
  },
});`;

const SCHEMA = `$ secondlayer codegen index --target kysely \\
    --tables decoded_events -o schema.ts
✓ Wrote kysely Index schema to schema.ts

$ secondlayer codegen index --target drizzle -o schema.ts
$ secondlayer codegen index --target prisma -o schema.prisma`;

const DEPLOY = `import { consumerHealth } from "@secondlayer/sdk";

const health = consumerHealth();
const shutdown = new AbortController();

Bun.serve({
  port: Number(process.env.PORT),
  fetch: health.handler,
});
process.on("SIGTERM", () => shutdown.abort());

await secondlayer.index.events.consume({
  // eventType, sink and onBatch as above
  onProgress: health.record,
  signal: shutdown.signal,
});`;

const HOSTS = [
	{
		title: "railway.json",
		lang: "json",
		code: `{
  "deploy": { "healthcheckPath": "/health" }
}`,
	},
	{
		title: "render.yaml",
		lang: "yaml",
		code: `# a web service: background workers get no health check and no PORT
services:
  - type: web
    name: sbtc-transfers
    healthCheckPath: /health`,
	},
	{
		title: "fly.toml",
		lang: "toml",
		code: `# scale-to-zero would suspend an outbound-only loop
[http_service]
  auto_stop_machines = false
  min_machines_running = 1`,
	},
	{
		title: "compose.yml",
		lang: "yaml",
		code: `services:
  indexer:
    build: .
    restart: unless-stopped
    stop_grace_period: 60s # the last batch commits`,
	},
] as const;

const EXPLORE = `$ secondlayer index ft-transfers \\
    --contract-id SM3V…sbtc-token --limit 1
{
  "events": [{
    "block_height": 8948506,
    "sender": "SP2J…R4K",
    "recipient": "SP3F…Q9A",
    "amount": "25000000", …
  }],
  "next_cursor": "8948506:12",
  "reorgs": []
}`;

const verifyAll = (
	toBlock: string,
	blocks: string,
) => `$ secondlayer verify all \\
    --against https://archive.secondlayer.tools/latest.json
  manifest    secondlayer-canonical v1 · mainnet
  coverage    0 → ${toBlock}   (${blocks} blocks)
  ✓ 0 broken ranges · 0 gaps · nothing uploaded

$ secondlayer repair --apply \\
    --against https://archive.secondlayer.tools/latest.json
  planned     3 partitions · events
  allowance   15 of 18 free partitions left this month
  ✓ charged $0.00`;

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
		example: ["deposit · 0.25 BTC", "Bitcoin transaction 7c1e…a0 · confirmed"],
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
							<ButtonLink href="/login">Build an indexer</ButtonLink>
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
							icon: <FilterIcon />,
							title: "No schema decisions up front",
							body: "Filter events by type, contract, sender or recipient before you commit to a table shape.",
						},
						{
							icon: <MailIcon />,
							title: "Finality is in the envelope",
							body: "Every page reports the tip, the finalized height and any reorg that crossed your cursor.",
						},
						{
							icon: <ShieldCheckIcon />,
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
								<Eyebrow noun="The indexer" />
								<h2>Your indexer is one file</h2>
								<p className="lede">
									<span className="mono">consume</span> walks every sBTC
									transfer since genesis, then keeps following the tip. Kill it
									mid-backfill and it resumes from the last committed row. No
									queue, no cron, no cursor table to design.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code
									lang="ts"
									variant="figure"
									title="indexer.ts"
									code={INDEXER}
								/>
							</div>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="The schema" />
								<h2>Tables that can't drift</h2>
								<p className="lede">
									The CLI writes typed tables from the same read contract the
									API serves. Change the event type and the compiler tells you
									which column broke.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code lang="text" title="~/sbtc-transfers" code={SCHEMA} />
							</div>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="Deploy" />
								<h2>Ship it where you ship everything else</h2>
								<p className="lede">
									One Dockerfile, any host that keeps a process running. A
									health route that tells a long backfill from a stuck loop, and
									a shutdown that always finishes the batch in flight.
								</p>
								<div className="chips">
									{["indexer.ts", "schema.ts", "database.ts", "Dockerfile"].map(
										(file) => (
											<span className="chip mono" key={file}>
												{file}
											</span>
										),
									)}
								</div>
								<Link className="more" href="/docs/deploy">
									Deploy guide →
								</Link>
							</>
						}
						art={
							<div className="art stack">
								<Code
									lang="ts"
									variant="figure"
									title="indexer.ts"
									code={DEPLOY}
								/>
								<CodeTabs variant="figure">
									{HOSTS.map((host) => (
										<Code key={host.title} {...host} />
									))}
								</CodeTabs>
							</div>
						}
					/>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Who runs what" />
						<h2>We meter the rows. You own the rest.</h2>
					</div>
					<Ownership
						nodes={[
							{
								who: "secondlayer",
								name: "Index",
								body: "Every event since genesis, decoded and signed",
							},
							{
								who: "you · Render",
								name: "indexer.ts",
								body: "Your filters, your logic, your deploy",
								yours: true,
							},
							{
								who: "you · any Postgres",
								name: "your tables",
								body: "Read them as often as you want, free",
								yours: true,
							},
						]}
						links={[
							{ label: "rows delivered", meter: "metered" },
							{ label: "rows + checkpoint" },
						]}
						ours="We run the decoded index, finality and the signed manifest."
						yours="You run the code, the host, the database and the uptime. Filter tighter and the bill drops with the output."
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

			<div className="band band-soft">
				<div className="shell">
					<Split
						flip
						copy={
							<>
								<Eyebrow noun="Explore" />
								<h2>Look before you write the loop</h2>
								<p className="lede">
									The CLI reads the same index with the same filters. Find the
									shape you want, then move those flags into{" "}
									<span className="mono">consume</span> unchanged.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code lang="text" title="~/sbtc-transfers" code={EXPLORE} />
							</div>
						}
					/>

					<Split
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
							<div className="art">
								<Code
									lang="text"
									title="~/instance"
									code={verifyAll(toBlock, blocks)}
								/>
							</div>
						}
					/>

					<Manifest
						title="secondlayer-canonical · v1 · mainnet"
						rows={manifestRows(signed)}
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
						Ship your first indexer <Highlight>today</Highlight>
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
