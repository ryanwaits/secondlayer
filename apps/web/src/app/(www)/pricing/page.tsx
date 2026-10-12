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
	STACK_MEMORY_FLOOR_GB,
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
const EXAMPLE_CAP_USD = 60;

/** The example statement in the hero: every figure comes from the estimator math. */
const EXAMPLE = {
	rows: 6_000_000,
	headers: 43_800,
	storageGb: 0.4,
	webhookEvents: 800_000,
	checks: 31,
	retries: 3_214,
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
		body: "Stop it and memory billing stops with it.",
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
		running: true,
		memoryGb: STACK_MEMORY_FLOOR_GB,
		storageGb: EXAMPLE.storageGb,
		webhookEvents: EXAMPLE.webhookEvents,
	});

	return (
		<main className="site pricing">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun="Pricing" verb="usage only" />
						<h1>
							Pay for rows delivered. <Highlight>Checking is free.</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/login">Start free</ButtonLink>
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
							aria-label={`Example monthly statement totalling ${usdExact(example.totalUsd)}, with free lines for the first million rows, block headers, retries and verification`}
						>
							<div className="stmt-head">
								<b>Statement · October</b>
								<span>example statement</span>
							</div>
							<div className="stmt-rows">
								<div className="stmt-row">
									<span>Rows delivered</span>
									<span className="q">
										{count.format(EXAMPLE.rows)} · first{" "}
										{count.format(FREE_ROWS_PER_MONTH)} free
									</span>
									<span className="amt">{usdExact(example.rowsUsd)}</span>
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
									<span>Hosted stack · memory</span>
									<span className="q">
										{STACK_MEMORY_FLOOR_GB} GB × {HOURS_PER_MONTH} h
									</span>
									<span className="amt">{usdExact(example.memoryUsd)}</span>
								</div>
								<div className="stmt-row">
									<span>Hosted stack · storage</span>
									<span className="q">{EXAMPLE.storageGb} GB-month</span>
									<span className="amt">{usdExact(example.storageUsd)}</span>
								</div>
								<div className="stmt-row">
									<span>Webhook events</span>
									<span className="q">
										{count.format(EXAMPLE.webhookEvents)} delivered
									</span>
									<span className="amt">{usdExact(example.webhooksUsd)}</span>
								</div>
								<div className="stmt-row">
									<span>Webhook retries</span>
									<span className="q">{count.format(EXAMPLE.retries)}</span>
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
							</div>
							<div className="stmt-total">
								<span>Total</span>
								<b>{usdExact(example.totalUsd)}</b>
							</div>
							<p className="stmt-foot">
								debited from a prepaid balance · example cap{" "}
								{usd(EXAMPLE_CAP_USD)} / month
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
										{STACK_MEMORY_FLOOR_GB} GB minimum while it runs, about{" "}
										{usd(
											Math.round(
												STACK_MEMORY_FLOOR_GB *
													HOURS_PER_MONTH *
													MEMORY_USD_PER_GB_HOUR,
											),
										)}{" "}
										a month. A stopped stack bills nothing.
									</td>
								</tr>
								<tr>
									<td>
										Stack storage<span className="tag">Subgraphs</span>
									</td>
									<td className="what">
										The tables your subgraphs keep on your stack.
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
										{usd(ARCHIVE_PARTITION_USD)} blocks or tx
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
						<Eyebrow noun="FAQ" />
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
										Reads past your free {FREE_ROWS_LABEL} stop with{" "}
										<code>402 spend_cap_reached</code> until the next month.
										Webhooks keep running, so your server still hears about the
										chain.
									</>
								),
							},
							{
								q: "Why does the stack have a minimum?",
								a: `A running stack holds memory whether it's busy or not, so it bills at least ${STACK_MEMORY_FLOOR_GB} GB, about ${usd(Math.round(STACK_MEMORY_FLOOR_GB * HOURS_PER_MONTH * MEMORY_USD_PER_GB_HOUR))} a month. Stop it and the memory charge stops. Your webhooks and subgraphs share the one stack, so there's no charge per webhook.`,
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
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="#estimate" variant="secondary">
							Estimate your month
						</ButtonLink>
					</>
				}
				caption="Every month, on every account · self-host free forever"
			/>
		</main>
	);
}
