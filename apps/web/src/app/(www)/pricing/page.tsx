import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
} from "@/components/site";
import { socialMeta } from "@/lib/og";
import {
	ARCHIVE_EVENTS_PARTITION_USD,
	ARCHIVE_PARTITION_USD,
	CREDIT_PACKS_USD,
	FREE_REPAIR_PARTITIONS_PER_MONTH,
	FREE_ROWS_PER_MONTH,
	HOURS_PER_MONTH,
	MEMORY_USD_PER_GB_HOUR,
	ROW_USD_PER_M,
	ROW_USD_PER_M_VOLUME,
	STACK_FLOOR_USD_PER_MONTH,
	STORAGE_USD_PER_GB_MONTH,
	VOLUME_TIER_MONTHLY_USD,
	WEBHOOK_USD_PER_M,
	estimateMonth,
	usd,
	usdExact,
} from "@/lib/prices";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PricingEstimator } from "./pricing-estimator";

const LEDE =
	"One meter for chain data, live or history, from Index or Streams. Your hosted stack bills only while it runs. Everything you run yourself costs nothing.";

export const metadata: Metadata = socialMeta({
	title: "Pricing · secondlayer",
	description: LEDE,
	image: "/og/pricing.png",
	path: "/pricing",
});

const FREE_ROWS_LABEL = `${FREE_ROWS_PER_MONTH / 1_000_000}M rows`;
const MEMORY_USD_PER_GB_MONTH = Math.round(
	MEMORY_USD_PER_GB_HOUR * HOURS_PER_MONTH,
);
const FLOOR_WEBHOOKS = usd(STACK_FLOOR_USD_PER_MONTH.webhooks);
const FLOOR_SUBGRAPHS = usd(STACK_FLOOR_USD_PER_MONTH.subgraphs);

/** The hero's example statement: a first month that stays inside every free
 *  allowance, so the first price on the page is $0. Figures come from the
 *  estimator math. */
const EXAMPLE = {
	rows: 640_000,
	headers: 43_800,
	checks: 31,
} as const;

const count = new Intl.NumberFormat("en-US");

const FREE_GRID: readonly {
	key: string;
	title: ReactNode;
	body: ReactNode;
}[] = [
	{
		key: "rows",
		title: (
			<>
				<Highlight>{FREE_ROWS_LABEL}</Highlight> a month
			</>
		),
		body: "On every account, before any balance is touched.",
	},
	{
		key: "headers",
		title: "Block headers",
		body: `Never billed, and never count toward the ${FREE_ROWS_LABEL}.`,
	},
	{
		key: "proofs",
		title: "Proofs and verify",
		body: (
			<>
				<code>/v1/proofs</code>, <code>verify block</code> and archive checks.
				Proofs are rate-limited, never metered.
			</>
		),
	},
	{
		key: "retries",
		title: "Webhook retries",
		body: "A failed delivery is retried and logged at no charge.",
	},
	{
		key: "tables",
		title: "Your own tables",
		body: "Reading the tables your subgraph fills costs nothing.",
	},
	{
		key: "stopped",
		title: "A stopped stack",
		body: "Pause or delete every webhook and subgraph and the stack stops within minutes, and so does the memory charge.",
	},
	{
		key: "etag",
		title: "Finalized pages again",
		body: (
			<>
				Send <code>If-None-Match</code> on a finalized page and the{" "}
				<code>304</code> is free.
			</>
		),
	},
	{
		key: "self",
		title: "Self-host",
		body: "The whole runtime, MIT licensed. Free forever, no key over loopback.",
	},
];

export default function PricingPage() {
	const example = estimateMonth({
		rows: EXAMPLE.rows,
		running: false,
		hasSubgraphs: false,
		memoryGb: 0,
		storageGb: 0,
		webhookEvents: 0,
	});

	return (
		<main className="site pricing">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun="Pricing" />
						<h1>
							Pay for rows delivered. <Highlight>Checking is free.</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/signin">Start free</ButtonLink>
							<ButtonLink href="#estimate" variant="secondary">
								Estimate your month
							</ButtonLink>
						</div>
						<p className="cap">
							No plans, no seats. Prepaid, with a monthly cap you set.
						</p>
					</div>

					<div className="hero-art">
						<div
							className="stmt"
							role="img"
							aria-label={`Example first-month statement totalling ${usdExact(example.totalUsd)}: rows under the free million, block headers and verification all free, no hosted stack`}
						>
							<div className="stmt-head">
								<b>Statement · first month</b>
								<span>example statement</span>
							</div>
							<div className="stmt-rows">
								<div className="stmt-row">
									<span>Rows delivered</span>
									<span className="q">
										{count.format(EXAMPLE.rows)} · under the{" "}
										{count.format(FREE_ROWS_PER_MONTH)} free
									</span>
									<span className="amt">
										<span className="free">free</span>
									</span>
								</div>
								<div className="stmt-row">
									<span>Block headers</span>
									<span className="q">
										{count.format(EXAMPLE.headers)} rows
									</span>
									<span className="amt">
										<span className="free">free</span>
									</span>
								</div>
								<div className="stmt-row">
									<span>verify · proofs</span>
									<span className="q">{EXAMPLE.checks} checks</span>
									<span className="amt">
										<span className="free">free</span>
									</span>
								</div>
								<div className="stmt-row">
									<span>Hosted stack</span>
									<span className="q">not running</span>
									<span className="amt muted">
										{usdExact(example.memoryUsd)}
									</span>
								</div>
							</div>
							<div className="stmt-total">
								<span>Total</span>
								<b>{usdExact(example.totalUsd)}</b>
							</div>
							<p className="stmt-foot">
								Past {FREE_ROWS_LABEL}: {usd(ROW_USD_PER_M)} per 1M.{" "}
								<a href="#estimate">Estimate a bigger month →</a>
							</p>
						</div>
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Free" />
						<h2>What you never pay for</h2>
						<p className="lede">
							Checking our work, retrying our deliveries and running it yourself
							stay free. That part of the deal doesn't change with volume.
						</p>
					</div>
					<div className="freegrid">
						{FREE_GRID.map((f) => (
							<div key={f.key}>
								<span className="v">{f.title}</span>
								<p>{f.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band band-soft" id="meters">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Meters" />
						<h2>Five meters, one prepaid balance</h2>
						<p className="lede">
							Each line on your statement maps to one row here. Nothing else is
							billed.
						</p>
					</div>
					<div className="tblwrap">
						<table className="meters-t">
							<thead>
								<tr>
									<th>Meter</th>
									<th>What it counts</th>
									<th>Price</th>
									<th>What else to know</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>
										Rows delivered<span className="tag">Index · Streams</span>
									</td>
									<td className="what">
										Event and transaction rows, live tip or history, at the same
										rate.
									</td>
									<td className="price">
										{usd(ROW_USD_PER_M)} / 1M rows
										<small>
											{usd(ROW_USD_PER_M_VOLUME)} / 1M once the month passes{" "}
											{usd(VOLUME_TIER_MONTHLY_USD)}
										</small>
									</td>
									<td className="note">
										First {FREE_ROWS_LABEL} free each month. Decoded datasets
										(PoX-5, sBTC, Runes) cost the same as any row.
									</td>
								</tr>
								<tr>
									<td>
										Stack memory
										<span className="tag">Subgraphs · Webhooks</span>
									</td>
									<td className="what">
										Your hosted stack, which runs your webhooks and subgraphs,
										averaged by the hour.
									</td>
									<td className="price">
										~{usd(MEMORY_USD_PER_GB_MONTH)} / GB-month
										<small>{usd(MEMORY_USD_PER_GB_HOUR)} / GB-hour</small>
									</td>
									<td className="note">
										Webhooks only: {FLOOR_WEBHOOKS}/mo minimum while your stack
										runs. With subgraphs: {FLOOR_SUBGRAPHS}/mo minimum. A
										stopped stack bills nothing.
									</td>
								</tr>
								<tr>
									<td>
										Stack storage
										<span className="tag">Subgraphs · Webhooks</span>
									</td>
									<td className="what">
										The tables your stack keeps: webhooks, their delivery log,
										and subgraph rows.
									</td>
									<td className="price">
										~{usd(STORAGE_USD_PER_GB_MONTH)} / GB-month
										<small>billed daily</small>
									</td>
									<td className="note">
										A subgraph's indexing bills the rows it reads, at the rows
										rate.
									</td>
								</tr>
								<tr>
									<td>
										Webhook events<span className="tag">Webhooks</span>
									</td>
									<td className="what">Events delivered to a URL you run.</td>
									<td className="price">
										{usd(WEBHOOK_USD_PER_M)} / 1M events
									</td>
									<td className="note">
										Retries are free. The rows read to match your triggers are
										ours, not yours.
									</td>
								</tr>
								<tr>
									<td>
										Archive partitions<span className="tag">Archive</span>
									</td>
									<td className="what">
										Signed partitions fetched for bootstrap, backfill or repair.
									</td>
									<td className="price">
										{usd(ARCHIVE_PARTITION_USD)} blocks or transactions
										<small>
											{usd(ARCHIVE_EVENTS_PARTITION_USD)} events · per partition
										</small>
									</td>
									<td className="note">
										Every fetch is quoted before it's charged. First{" "}
										{FREE_REPAIR_PARTITIONS_PER_MONTH} repair partitions each
										month are free. Credit packs{" "}
										{CREDIT_PACKS_USD.map(usd).join(", ")}.
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<div className="band" id="estimate">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Estimate" />
						<h2>What would your month cost?</h2>
						<p className="lede">
							Move the sliders to your expected volume. The math matches the
							meters above.
						</p>
					</div>
					<PricingEstimator />
				</div>
			</div>

			<div className="band band-soft band-slim">
				<div className="shell">
					<div className="talk">
						<p>
							Moving billions of rows, or need terms on paper?{" "}
							<span>
								Tell us what you're building and we'll work out a contract.
							</span>
						</p>
						<ButtonLink href="/contact?from=/pricing" variant="secondary">
							Talk to us
						</ButtonLink>
					</div>
				</div>
			</div>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<h2>Pricing questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "What counts as a row?",
								a: "One event or one transaction delivered to you from Index or Streams. A page of 1,000 events is 1,000 rows. Block headers are free and never counted. Filters cut the bill along with the output, so a consumer for one contract pays for that contract's rows only.",
							},
							{
								q: "Do reorgs or retries cost me?",
								a: (
									<>
										Webhook retries are never billed. A reorg appears as a list
										on every envelope, and rows you read again after one count
										like any other delivery. Re-reading a finalized page with{" "}
										<code>If-None-Match</code> returns a free <code>304</code>,
										so you never pay twice for settled history.
									</>
								),
							},
							{
								q: "What happens when I hit my cap?",
								a: (
									<>
										Every charge stops. Reads past your free {FREE_ROWS_LABEL}{" "}
										answer <code>402 spend_cap_reached</code>, and your stack
										stops within minutes, so webhooks pause and subgraphs stop
										indexing until the next month or until you raise the cap.
										That&apos;s the tradeoff of a hard cap.
									</>
								),
							},
							{
								q: "Why does the stack have a minimum?",
								a: `A running stack holds memory whether it's busy or not. Webhooks only: ${FLOOR_WEBHOOKS}/mo minimum while your stack runs. With subgraphs: ${FLOOR_SUBGRAPHS}/mo minimum, since subgraphs add a process that runs your handlers. Pause or delete every webhook and subgraph and the stack stops within minutes, and so does the memory charge. Hitting your spend cap stops it too. There's no charge per webhook.`,
							},
							{
								q: "Is checking really free?",
								a: (
									<>
										Yes. Proofs, <code>verify block</code> and archive
										verification never touch your balance. Proofs are
										rate-limited to keep them up for everyone. Repairing a
										broken range is the paid part, and the first{" "}
										{FREE_REPAIR_PARTITIONS_PER_MONTH} partitions each month are
										free.
									</>
								),
							},
							{
								q: "Can I move between hosted and self-host?",
								a: (
									<>
										Yes. Point <code>SECONDLAYER_API_URL</code> at your own
										instance and the same CLI, SDK and routes answer. Your
										subgraph files run unchanged on either side.
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
						Your first <Highlight>{FREE_ROWS_LABEL}</Highlight> are already free
					</>
				}
				cta={
					<>
						<ButtonLink href="/signin">Start free</ButtonLink>
						<ButtonLink href="#estimate" variant="secondary">
							Estimate your month
						</ButtonLink>
					</>
				}
			/>
		</main>
	);
}
