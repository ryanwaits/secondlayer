import { Code } from "@/components/code/code";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	Props,
	RestOfPlatform,
	SelfHostSlot,
	Split,
	StatusDot,
} from "@/components/site";
import { SubgraphsHero } from "@/components/site/assets";
import { BoxIcon, FileXIcon, UndoIcon } from "@/components/site/icons";
import { socialMeta } from "@/lib/og";
import { GITHUB_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

const LEDE =
	"Write one TypeScript file. Get Postgres tables, a REST API and client types, backfilled from your start block and held at tip.";

export const metadata: Metadata = socialMeta({
	title: "Subgraphs · secondlayer",
	description: LEDE,
	image: "/og/subgraphs.png",
	path: "/p/subgraphs",
});

const [, , index, subgraphs] = PRODUCTS;

const SUBGRAPH_FILE = `import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "sbtc-flows",
  // !callout[/startBlock/] backfill starts here
  startBlock: 8000000,
  // !callout[/sources/] these events, nothing else
  sources: {
    transfers: { type: "ft_transfer", assetIdentifier: SBTC },
  },
  schema: {
    transfers: { columns: {
      amount: { type: "uint" },
      sender: { type: "principal" },
      recipient: { type: "principal" },
    } },
  },
  handlers: {
    transfers: (event, ctx) =>
      // !callout[/ctx.insert/] the write: one row per event
      ctx.insert("transfers", event),
  },
});`;

const READ_EXAMPLE = `const { rows, next_cursor, tip } =
  await sl.subgraphs.rows("sbtc-flows", "transfers",
    { limit: 10, order: "desc" });

{
  "rows": [{ "_id": 48138, "block_height": 8054704,
             "amount": 697078828, "sender": "SP3PE…X44J" }],
  // !callout[/"next_cursor"/] pass back as ?cursor
  "next_cursor": "48137",
  // !callout[/"tip"/] how far behind the table is
  "tip": { "block_height": 8054704, "blocks_behind": 0 }
}`;

const DEPLOY = `$ secondlayer subgraphs deploy subgraphs/sbtc-flows.ts \\
    --start-block 8000000
  ✓ Subgraph "sbtc-flows" created → v1.0.0
  REST     $SECONDLAYER_API_URL/v1/subgraphs/sbtc-flows/transfers

$ secondlayer subgraphs status sbtc-flows
  Status       reindexing
  Sync         14.2%  (1,174,885 / 8,263,594 blocks)
  Gaps         none
  Table Rows   transfers: 4,874`;

const VERIFY = `$ secondlayer verify subgraph pool-reserves \\
    --replay --from 1230000 --to 1231000
  ✓ pin       7f3c…a91e  bundle, schema, startBlock
  ✓ blocks    1,001 proven from the checkpoint
  ✓ txs       4,812 match their tx merkle roots
  ✓ inputs    1,001 diffs fully named
  ✓ handlers  37 events, deterministic realm
  ✓ rows      reserves: 14 equal  digest 9a1f…03be`;

const TRIGGER_SQL = `create function notify_transfer()
returns trigger as $$ begin
  perform pg_notify('transfers',
    row_to_json(new)::text);
  return new;
end $$ language plpgsql;

create trigger on_transfer
  after insert on transfers
  for each row
  execute function notify_transfer();`;

const ROW_STREAM = `const stop = subgraph.transfers.subscribe(
  (row) => onTransfer(row),
  { since: 9137000,
    where: { sender: "SP3PE…X44J" } },
);

// or page with ?cursor=next_cursor
// on your own schedule`;

const WEBHOOK_CMD = `secondlayer webhooks create sbtc-in \\
  --url https://app.example/hook \\
  --trigger '{"type":"sbtc_deposit"}'`;

export default function SubgraphsPage() {
	return (
		<main className="site product">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={subgraphs.noun} verb={subgraphs.verb} />
						<h1>
							Your contract, <Highlight>as a table.</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/login">Deploy a subgraph</ButtonLink>
							<ButtonLink href="/docs/subgraphs" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<p className="cap">Reading your tables is free</p>
						<div className="odo">
							<span className="odo-n word">1 file</span>
							<span className="cap">tables · REST API · client types</span>
						</div>
					</div>
					<div className="hero-art">
						<SubgraphsHero />
					</div>
				</div>

				<Props
					items={[
						{
							icon: <FileXIcon />,
							title: "A schema change breaks the build",
							body: "Handlers and client types come from the same file, so a renamed column fails in your editor, not in production.",
						},
						{
							icon: <UndoIcon />,
							title: "Reorgs roll your rows back",
							body: "An orphaned block takes its rows with it, and the canonical ones replace them. No cleanup job to write.",
						},
						{
							icon: <BoxIcon />,
							title: "Tested on real blocks first",
							body: (
								<>
									<span className="mono">subgraphs test</span> runs your
									handlers over a real block range. Events in and zero rows out
									fails the run.
								</>
							),
						},
					]}
				/>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<Split
						wide
						copy={
							<>
								<Eyebrow noun="The file" />
								<h2>Sources, schema, handlers. That's the whole thing.</h2>
								<p className="lede">
									Name the events you care about, declare the table, and write
									one handler per source. Contract sets, contracts a factory
									deploys later, and every token of a standard all fit the same
									shape.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code
									lang="ts"
									variant="figure"
									title="subgraphs/sbtc-flows.ts"
									code={SUBGRAPH_FILE}
								/>
							</div>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="The deploy" />
								<h2>Queryable while it fills</h2>
								<p className="lede">
									The first deploy backfills from your start block, then new
									blocks stream in. Go live at the tip first if your handlers
									only insert, and let history catch up behind.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code lang="text" title="~/app" code={DEPLOY} />
							</div>
						}
					/>

					<Split
						wide
						copy={
							<>
								<Eyebrow noun="The read" />
								<h2>Read it typed, or over REST</h2>
								<p className="lede">
									The SDK knows your columns. REST pages the same rows with a
									cursor and reports how far the table is behind the tip, in the
									same envelope the index uses.
								</p>
							</>
						}
						art={
							<div className="art">
								<Code
									lang="ts"
									variant="figure"
									title="GET /v1/subgraphs/sbtc-flows/transfers"
									code={READ_EXAMPLE}
								/>
							</div>
						}
					/>

					<div className="meters three">
						{[
							{
								k: "Reading your tables",
								v: "$0",
								p: "Every read of your own subgraph, REST, SDK or stream. Point a dashboard at it and leave it running.",
							},
							{
								k: "Indexing",
								v: "$5 / 1M rows",
								p: "Event and transaction rows the subgraph reads to fill itself. The first 1M each month are free, so set a start block.",
							},
							{
								k: "Hosted stack",
								v: "~$10 / mo",
								p: "Memory from a 0.5 GB floor while it runs, plus storage. A stopped stack bills no memory.",
							},
						].map((m) => (
							<div className="meter" key={m.k}>
								<span className="k">{m.k}</span>
								<span className="v">{m.v}</span>
								<p>{m.p}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Where it runs" />
						<h2>Your box or ours, the same file</h2>
						<p className="lede">
							Hosted is one private stack per account in a sandbox. On your own
							box any source runs, with the same CLI and the same routes.
						</p>
					</div>
					<div className="where tblwrap">
						<table>
							<thead>
								<tr>
									<th />
									<th>Hosted</th>
									<th>Self-host</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>Sources</td>
									<td>
										Event filters, <code>contract_call</code>,{" "}
										<code>contract_deploy</code>. Anything else is refused at
										deploy, naming the source.
									</td>
									<td>Any source</td>
								</tr>
								<tr>
									<td>Isolation</td>
									<td>
										Handlers run in a gVisor sandbox with 512 MB, reaching only
										the secondlayer API and the public internet
									</td>
									<td>Your machine, your rules</td>
								</tr>
								<tr>
									<td>Visibility</td>
									<td>Private to your account</td>
									<td>Private to your network</td>
								</tr>
								<tr>
									<td>Failure</td>
									<td>
										A stalled handler restarts. Three deaths at the same height
										marks it <code>error</code>: fix and redeploy
									</td>
									<td>Same, in your logs</td>
								</tr>
								<tr>
									<td>Cost</td>
									<td className="mono">
										indexing rows + stack memory + storage
									</td>
									<td className="mono">free · MIT</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<Split
						copy={
							<>
								<Eyebrow noun="Rows anyone can recompute" />
								<h2>Check the table without asking us</h2>
								<p className="lede">
									A subgraph built only from contract state writes earns the{" "}
									<span className="mono">state</span> level. Anyone can rebuild
									its rows from block proofs and compare them with what the API
									serves.
								</p>
								<div className="lv-list">
									<div>
										<b className="on">state</b>
										<span>
											State writes only. Handlers must be deterministic, or the
											deploy is refused with the line that broke the rule.
										</span>
									</div>
									<div>
										<b>events</b>
										<span>
											Events, prints or contract calls. Deploys as usual; rows
											stay advisory until event proofs exist.
										</span>
									</div>
									<div>
										<b>none</b>
										<span>Trait scope or tip-first backfill. Advisory.</span>
									</div>
								</div>
								<p className="limit">
									<b>Not covered yet:</b> which transaction made a write, and
									writes overwritten inside one block. State-write history on
									hosted is <StatusDot state="soon" label="coming soon" />
								</p>
							</>
						}
						art={
							<div className="art">
								<Code lang="text" title="~/app" code={VERIFY} />
							</div>
						}
					/>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="React to your rows" />
						<h2>Your rows, your trigger</h2>
						<p className="lede">
							The table is yours, so reacting to it is too. Use what your
							database already does, hold a stream open, or get pushed by the
							chain itself.
						</p>
					</div>
					<div className="react">
						<div>
							<span className="k">Self-host · your Postgres</span>
							<h3>A trigger on the table</h3>
							<p>
								Rows land in your own database.{" "}
								<span className="mono">LISTEN/NOTIFY</span> tells your app the
								moment one is written.
							</p>
							<pre>{TRIGGER_SQL}</pre>
						</div>
						<div>
							<span className="k">Hosted · the row stream</span>
							<h3>Tail the table</h3>
							<p>
								Server-sent events from the tip, or replay from a height and
								keep going. Same filters as a read.
							</p>
							<pre>{ROW_STREAM}</pre>
						</div>
						<div>
							<span className="k">Chain events · Webhooks</span>
							<h3>Pushed to your server</h3>
							<p>
								When the trigger is something on-chain, skip the table. A
								webhook delivers the event itself, signed, retried and logged.
							</p>
							<pre>{WEBHOOK_CMD}</pre>
							<Link className="go" href="/p/webhooks">
								/webhooks →
							</Link>
						</div>
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Rest of the platform" />
						<h2>Same chain data, other surfaces</h2>
					</div>
					<RestOfPlatform
						exclude={["/p/subgraphs", "/p/archive"]}
						blurbs={{
							"/p/index": {
								title: "Before you know the shape",
								body: "Query decoded events by type, contract or address while you work out which table you want.",
							},
							"/p/streams": {
								title: "You hold the cursor",
								body: "Every event as a pull you resume yourself, when you already run a sink and want no state on our side.",
							},
							"/p/webhooks": {
								title: "We hold the retry queue",
								body: "Chain events pushed to a URL you run, with failed deliveries logged and requeueable.",
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
				and the same <span className="mono">subgraphs deploy</span> writes to
				your Postgres. Codegen for Prisma, Drizzle or Kysely reads those tables
				directly.
			</SelfHostSlot>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<h2>Subgraph questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "Do I get to pick the API shape?",
								a: (
									<>
										No. A subgraph serves its tables over one REST shape with
										cursors, filters and sorting. If you need your own
										endpoints, read the{" "}
										<Link
											href={index.href}
											style={{ textDecoration: "underline" }}
										>
											Index
										</Link>{" "}
										and build them.
									</>
								),
							},
							{
								q: "What happens on a reorg?",
								a: "Rows written from the orphaned block are rolled back and the canonical block's rows are written. Contracts a factory discovered on the orphaned fork stop matching too.",
							},
							{
								q: "How is a hosted subgraph billed?",
								a: "Indexing bills the event and transaction rows it reads, at $5 per 1M past the free 1M each month. The stack bills memory from a 0.5 GB floor, about $10 a month while it runs, plus storage. Reading your own tables is free.",
							},
							{
								q: "Can I get a webhook when a row changes?",
								a: "Not from us. On your own box, a Postgres trigger does it in a few lines. Hosted, tail the table's row stream. If what you care about is an on-chain event, a chain webhook delivers it directly.",
							},
							{
								q: "Can I test before I deploy?",
								a: (
									<>
										<code>secondlayer subgraphs test</code> runs your local
										handlers over a real block range. The first run records a
										cassette, so later runs are free and offline.
									</>
								),
							},
						]}
					/>
				</div>
			</div>

			<CloseBand
				title={
					<>
						Deploy your first subgraph <Highlight>today</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/docs/subgraphs" variant="secondary">
							Read the docs
						</ButtonLink>
					</>
				}
			/>
		</main>
	);
}
