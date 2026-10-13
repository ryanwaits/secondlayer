import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	Meters,
	Odometer,
	Props,
	RestOfPlatform,
	SelfHostSlot,
	Split,
	Terminal,
} from "@/components/site";
import { ArchiveHero } from "@/components/site/assets";
import { formatCount, getSignedCounts, manifestRows } from "@/lib/chain-stats";
import { socialMeta } from "@/lib/og";
import { GITHUB_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArchiveCredits } from "./archive-credits";

const LEDE =
	"Genesis to tip as signed, digest-addressed partitions. Check a running database against them read-only, repair only the ranges that break, or stand up a fresh box in hours.";

export const metadata: Metadata = socialMeta({
	title: "Archive · secondlayer",
	description: LEDE,
	image: "/og/archive.png",
	path: "/p/archive",
});

const [archive] = PRODUCTS;

const JOBS: readonly {
	id?: string;
	tag: "free" | "metered";
	title: string;
	body: ReactNode;
	cmd: string;
}[] = [
	{
		id: "verify-cmd",
		tag: "free",
		title: "Verify an instance",
		body: "Digest-check every range of your data against the manifest, read-only.",
		cmd: "secondlayer verify all",
	},
	{
		tag: "metered",
		title: "Bootstrap a fresh box",
		body: "Genesis to tip arrives as verified partitions instead of a replay.",
		cmd: "secondlayer bootstrap",
	},
	{
		tag: "metered",
		title: "Backfill history",
		body: "Fill the range behind your node's reach, then follow it forward for free.",
		cmd: "secondlayer bootstrap \\\n  --to-block <n>",
	},
	{
		tag: "metered",
		title: "Repair gaps",
		body: (
			<>
				Plans the fix as a dry run, then heals exactly those partitions with{" "}
				<code>--apply</code>.
			</>
		),
		cmd: "secondlayer repair --apply",
	},
];

/** Partition fetch price per dataset; rows and shares come from the manifest. */
const FETCH: Record<string, string> = {
	events: "$0.15 / partition",
	transactions: "$0.05 / partition",
	blocks: "$0.05 / partition",
};

const FILES: readonly { path: string; body: string }[] = [
	{
		path: "snapshots/<digest>.json",
		body: "The signed manifest: coverage, counts, per-object digests, finality rule and audit.",
	},
	{
		path: "blocks/ · transactions/ · events/",
		body: "Range-partitioned Parquet, digest in the filename.",
	},
	{
		path: "digests/<range>-<sha16>.parquet",
		body: "One row per height with the block digest and rolled-up transaction and event digests.",
	},
	{
		path: "attestations/<digest>/node.json",
		body: "A signed independent node audit: the attested window, exact stats, a sample of any mismatches.",
	},
	{
		path: "status.json",
		body: "Operational state: fresh, lagging, stale, gap, failed-audit or source-unavailable.",
	},
	{
		path: "reports/incidents/",
		body: "Signed incident reports, newest first. When we get something wrong, it is written down here.",
	},
];

const LEVELS: readonly {
	now?: boolean;
	state: string;
	name: string;
	body: string;
}[] = [
	{
		now: true,
		state: "most ranges today",
		name: "db-reconstructive",
		body: "Rebuilds the database exactly as the indexer wrote it. You trust our indexer, and you can check every byte it produced.",
	},
	{
		state: "where attested",
		name: "node-attested",
		body: "An independent node re-read the range and signed what it found. A smaller thing to trust.",
	},
	{
		state: "where attested",
		name: "observer-attested",
		body: "Checked against what a node observed live, as it happened. The level each range reaches is in the manifest.",
	},
];

export default async function ArchivePage() {
	const signed = await getSignedCounts();
	const toBlock = formatCount(signed.toBlock);
	const blocks = formatCount(signed.blocks);
	return (
		<main className="site product">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={archive.noun} verb={archive.verb} />
						<h1>
							Signed history. <Highlight>Check your copy for free.</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="#verify-cmd">Verify your instance</ButtonLink>
							<ButtonLink href="/docs/archive" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<Odometer value={signed.blocks} label="blocks, zero gaps" />
					</div>
					<div className="hero-art">
						<ArchiveHero />
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
									<rect x="3" y="8.5" width="14" height="9" rx="1.5" />
									<path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" />
								</svg>
							),
							title: "Nothing leaves your machine",
							body: "Verify reads your database and the public manifest. No upload, no account, no charge.",
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
									<path d="M3 10h4l2-4 2 8 2-4h4" />
								</svg>
							),
							title: "Repair touches only what broke",
							body: "Each fix is one transaction per partition, so an interrupted repair leaves no half-corrected range.",
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
							title: "A fresh box in hours",
							body: "Bootstrap restores from signed partitions instead of replaying the chain, then follows your node forward.",
						},
					]}
				/>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Four jobs" />
						<h2>One signed set, four ways to use it</h2>
						<p className="lede">
							Verify is free. The three that fetch partitions are quoted against
							your balance before anything is charged.
						</p>
					</div>
					<div className="jobs">
						{JOBS.map((j) => (
							<div className="job" id={j.id} key={j.title}>
								<span className={j.tag === "free" ? "tagp free" : "tagp"}>
									{j.tag}
								</span>
								<h3>{j.title}</h3>
								<p>{j.body}</p>
								<code>{j.cmd}</code>
							</div>
						))}
					</div>

					<Split
						copy={
							<>
								<Eyebrow noun="Verify, then repair" />
								<h2>Checking us is free, forever</h2>
								<p className="lede">
									Run verify as often as you like. When it finds a broken range,
									repair fetches only those partitions, checks each against its
									signed digest before reading a row, and writes it back.
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
									<span className="t-m">
										{"  broken      events 8,930,000 → 8,939,999"}
									</span>
									{"\n\n"}
									<span className="t-m">{"❯ "}</span>
									<span className="t-a">secondlayer repair</span>
									{
										" --apply \\\n    --against https://archive.secondlayer.tools/latest.json\n"
									}
									<span className="t-m">
										{"  planned     1 partition · events"}
									</span>
									{"\n"}
									<span className="t-m">{"  allowance   "}</span>
									<span className="t-a">
										{"17 of 18 free partitions left this month"}
									</span>
									{"\n"}
									<span className="t-hit">
										{"  ✓ repaired · re-verified · charged $0.00"}
									</span>
								</pre>
							</Terminal>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="Bootstrap" />
								<h2>Skip the replay</h2>
								<p className="lede">
									Bootstrap prints both timings before it starts, then restores
									and verifies itself. Pass <code>--from-block</code> to restore
									forward only; everything below is declared out of scope, so
									verify doesn't read it as missing.
								</p>
								<p className="cap">sample timings</p>
							</>
						}
						art={
							<div
								className="art timing"
								role="img"
								aria-label="Sync from genesis about 19.4 days compared with restore from archive about 2.3 hours, drawn to scale"
							>
								<div className="row slow">
									<div className="lbl">
										<span>sync from genesis</span>
										<span>~19.4 days</span>
									</div>
									<div className="track">
										<i />
									</div>
								</div>
								<div className="row fast">
									<div className="lbl">
										<span>restore from archive</span>
										<span>~2.3 hours</span>
									</div>
									<div className="track">
										<i style={{ width: "0.49%" }} />
									</div>
								</div>
							</div>
						}
					/>

					<div className="mani">
						<div className="mani-head">
							<span className="seal">
								<i />
								signed
							</span>
							<span className="t">secondlayer-canonical · v1 · mainnet</span>
						</div>
						<div className="tblwrap">
							<table>
								<thead>
									<tr>
										<th>Dataset</th>
										<th className="num">Rows</th>
										<th>Share of the set</th>
										<th>Coverage</th>
										<th className="num">Fetch</th>
									</tr>
								</thead>
								<tbody>
									{manifestRows(signed).map((r) => (
										<tr key={r.dataset}>
											<td>{r.dataset}</td>
											<td className="num">{r.rows}</td>
											<td>
												<div className="bar">
													{r.share}%
													<span>
														<i style={{ width: `${r.share}%` }} />
													</span>
												</div>
											</td>
											<td className="mono">{r.coverage}</td>
											<td className="num">{FETCH[r.dataset]}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="What's published" />
						<h2>Everything you need to check us, in the open</h2>
						<p className="lede">
							Append-only on R2. Each partition carries a SHA-256 over its bytes
							and a semantic digest over its canonical encoding.
						</p>
					</div>
					<div className="files">
						{FILES.map((f) => (
							<div key={f.path}>
								<code>{f.path}</code>
								<p>{f.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Assurance" />
						<h2>The strength of the claim, next to the claim</h2>
						<p className="lede">
							Every range in the manifest states which of three levels it
							reaches. Most of the set is at the first level today.
						</p>
					</div>
					<div className="levels">
						{LEVELS.map((l) => (
							<div className={l.now ? "level now" : "level"} key={l.name}>
								<span className="st">
									<i />
									{l.state}
								</span>
								<span className="k">{l.name}</span>
								<p>{l.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band band-soft">
				<div className="shell credits">
					<div className="copy">
						<Eyebrow noun="Credits" />
						<h2>Prepay for the runs that fetch</h2>
						<p className="lede">
							Bootstrap, backfill and repair draw from your account balance.
							Every run is quoted first, and a short balance stops it before
							anything is charged.
						</p>
						<Meters
							items={[
								{
									label: "Always free",
									value: "$0",
									body: "Verify, deep verify and reading the manifest. No account needed.",
								},
								{
									label: "Free every month",
									value: "18 partitions",
									body: "Of repair, on any account. Bootstrap and backfill are metered from the first partition.",
								},
							]}
						/>
					</div>
					<ArchiveCredits />
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Rest of the platform" />
						<h2>Built on this history</h2>
					</div>
					<RestOfPlatform
						exclude={["/p/archive"]}
						blurbs={{
							"/p/index": {
								title: "Typed rows from genesis",
								body: "Query decoded events behind one key, with the same manifest to check against.",
							},
							"/p/streams": {
								title: "You hold the cursor",
								body: "Every event in order, pulled from any point in history.",
							},
							"/p/subgraphs": {
								title: "Your contract, as a table",
								body: "Backfilled from this history and held at tip.",
							},
							"/p/webhooks": {
								title: "Your server, told first",
								body: "Chain events pushed to your endpoint as they land, with failed deliveries logged and requeueable.",
							},
						}}
					/>
				</div>
			</div>

			<SelfHostSlot
				title="How a new box starts"
				refs={
					<>
						<Link href="/docs/archive">docs/archive</Link>
						<Link href="/docs/self-host">docs/self-host</Link>
						<a href={GITHUB_URL}>GitHub</a>
					</>
				}
			>
				The archive is how a self-hosted instance skips weeks of replay.{" "}
				<span className="mono">secondlayer setup</span> offers a bootstrap on
				first boot; after that your node feeds the instance and verify keeps
				checking it against each new signed publish.
			</SelfHostSlot>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<h2>Archive questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "Do I need an account to verify?",
								a: (
									<>
										No. <code>secondlayer verify</code> reads your database and
										the public manifest. Nothing is uploaded and nothing is
										charged. An account key is only needed for runs that fetch
										partitions.
									</>
								),
							},
							{
								q: "How do I know the history is complete?",
								a: `The manifest publishes coverage (0 → ${toBlock}) and a block count (${blocks}). Count equals span, so there is no room for a gap. The per-height digest sidecar lets verify find exactly which range differs.`,
							},
							{
								q: "What does db-reconstructive mean for me?",
								a: "It means the archive rebuilds the database as our indexer wrote it. You still trust that indexer's reading of the chain. Ranges with a node attestation say so in the manifest, and block-level proofs live on the Verify page.",
							},
							{
								q: "What does a repair cost?",
								a: (
									<>
										The first 18 partitions each month are free. After that,
										$0.05 per block or transaction partition and $0.15 per event
										partition.{" "}
										<code>secondlayer archive quote --flow repair</code> prices
										it before anything runs.
									</>
								),
							},
							{
								q: "What if a run is interrupted?",
								a: "Each partition is hashed against its signed digest before any row is read, and written in one transaction. Run it again and it picks up the partitions that didn't land.",
							},
						]}
					/>
				</div>
			</div>

			<CloseBand
				title={
					<>
						Check your node against the signed set <Highlight>today</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="#verify-cmd">Verify your instance</ButtonLink>
						<ButtonLink href="/docs/archive" variant="secondary">
							Read the docs
						</ButtonLink>
					</>
				}
			/>
		</main>
	);
}
