import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { marketingUrl } from "@/lib/urls";
import { type UsageResponse, formatCents, formatNum } from "@/lib/usage";
import Link from "next/link";
import { Suspense } from "react";
import { BillingActions } from "./billing-actions";
import s from "./billing.module.css";
import { CreditsTopup } from "./credits-topup";
import { PlanModal } from "./plan-modal";

type BillingStatus = {
	plan: string;
	stripeCustomerId: string | null;
	creditsUsdMicros: string;
	creditsSpentThisMonthUsdMicros: string;
	subscription: {
		id: string;
		status: string;
		tier: string | null;
		interval: string | null;
		amountCents: number | null;
		trialEnd: string | null;
		currentPeriodEnd: string | null;
		cancelAt: string | null;
		cancelAtPeriodEnd: boolean;
	} | null;
};

type ProductUsageResponse = {
	streams: {
		eventsToday: number;
		eventsThisMonth: number;
	};
	index: {
		decodedEventsToday: number;
		decodedEventsThisMonth: number;
	};
	subgraphs: {
		used: number;
		limit: number | null;
	};
};

type LedgerState = "free" | "trialing" | "active" | "ending";
type Tier = "none" | "launch" | "scale" | "enterprise";

const PLAN_NAME: Record<string, string> = {
	none: "Free",
	launch: "Pro",
	scale: "Scale",
	enterprise: "Enterprise",
};

function fmtDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/** Compact a count into a [value, unit] pair for the usage tiles. */
function compact(n: number): [string, string] {
	if (n >= 1_000_000) return [(n / 1_000_000).toFixed(2), "M"];
	if (n >= 1_000) return [(n / 1_000).toFixed(1), "K"];
	return [formatNum(n), ""];
}

function compactStr(n: number): string {
	const [v, u] = compact(n);
	return u ? `${v} ${u}` : v;
}

function Section({ title }: { title: string }) {
	return (
		<div className={s.section}>
			<h2>{title}</h2>
			<span className={s.rule} />
		</div>
	);
}

export default async function BillingPage() {
	const session = await getSessionFromCookies();
	let status: BillingStatus | null = null;
	let usage: UsageResponse | null = null;
	let productUsage: ProductUsageResponse | null = null;

	if (session) {
		try {
			status = await apiRequest<BillingStatus>("/api/billing/status", {
				sessionToken: session,
			});
		} catch {}
		try {
			usage = await apiRequest<UsageResponse>("/api/accounts/usage", {
				sessionToken: session,
			});
		} catch {}
		try {
			productUsage = await apiRequest<ProductUsageResponse>(
				"/api/accounts/usage/products",
				{ sessionToken: session },
			);
		} catch {}
	}

	if (!status) {
		return (
			<>
				<OverviewTopbar
					path={<SettingsCrumb />}
					page="Billing"
					showRefresh={false}
				/>
				<div className="settings-scroll">
					<div className="overview-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Unable to load billing data.</p>
					</div>
				</div>
			</>
		);
	}

	const sub = status.subscription;
	const plan = status.plan as Tier;
	const state: LedgerState =
		sub?.status === "trialing" && !sub.cancelAtPeriodEnd
			? "trialing"
			: sub?.cancelAtPeriodEnd
				? "ending"
				: plan !== "none"
					? "active"
					: "free";

	const planName = PLAN_NAME[plan] ?? plan;
	const priceUsd =
		sub?.amountCents != null ? Math.round(sub.amountCents / 100) : 79;
	const trialEnds = fmtDate(sub?.trialEnd);
	const renews = fmtDate(sub?.currentPeriodEnd);
	const cancelDate = fmtDate(sub?.cancelAt ?? sub?.currentPeriodEnd);

	// Spend is a flat base price today (no per-SKU metering); credits draw down
	// reads + indexing beyond the free floor separately.
	const currentCents = usage?.spend.currentCents ?? 0;
	const nextInvoice = formatCents(usage?.spend.projectedCents ?? currentCents);
	const capCents = usage?.spend.capCents ?? null;
	const frozen = usage?.spend.frozen ?? false;
	const capPct =
		capCents && capCents > 0
			? Math.min(100, Math.round((currentCents / capCents) * 100))
			: null;

	const periodStart = usage ? new Date(usage.period.startIso) : new Date();
	const monthLabel = periodStart.toLocaleString("en-US", {
		month: "long",
		timeZone: "UTC",
	});
	const monthYear = periodStart.toLocaleString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

	const decodedToday = compact(productUsage?.index.decodedEventsToday ?? 0);
	const decodedMonth = compact(productUsage?.index.decodedEventsThisMonth ?? 0);

	// Subgraphs are slot-gated (capacity), not metered — show used / limit.
	const slotsUsed = productUsage?.subgraphs.used ?? 0;
	const slotsLimit = productUsage?.subgraphs.limit ?? null;
	const slotsValue =
		slotsLimit === null
			? `${formatNum(slotsUsed)} / ∞`
			: `${formatNum(slotsUsed)} / ${formatNum(slotsLimit)}`;

	const badge =
		state === "free" ? (
			<span className={`${s.badge} ${s.badgeFree}`}>free</span>
		) : state === "trialing" ? (
			<span className={`${s.badge} ${s.badgeTrial}`}>trial</span>
		) : state === "ending" ? (
			<span className={`${s.badge} ${s.badgeEnding}`}>
				ends {cancelDate ?? "soon"}
			</span>
		) : (
			<span className={`${s.badge} ${s.badgeActive}`}>active</span>
		);

	const settingsMeta =
		state === "free"
			? "Keyless reads stay free. Plans buy capacity, private subgraphs, and history."
			: state === "trialing"
				? `Trial ends ${trialEnds ?? "soon"} — then $${priceUsd}.00/${sub?.interval ?? "month"}.`
				: state === "ending"
					? `Cancels ${cancelDate ?? "at period end"}. Nothing further is charged; resume any time before then.`
					: sub
						? `Renews ${renews ?? "monthly"} · $${priceUsd}.00/${sub.interval ?? "month"}.`
						: "Billed directly · invoiced.";

	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Billing"
				showRefresh={false}
			/>
			<div className="settings-scroll">
				<div className="overview-inner">
					<h1 className="settings-title">Billing</h1>
					<p className="settings-desc">
						Plans buy capacity; public reads stay free either way. Full ladder
						on the <Link href={marketingUrl("/pricing")}>pricing page</Link>.
					</p>

					{/* Current plan + plan settings */}
					<div className={s.twoup}>
						<div className={s.card}>
							<div className={s.cardLabel}>Current plan</div>
							<div className={s.planName}>
								{planName}
								{badge}
							</div>
						</div>
						<div className={`${s.card} ${s.settingsCard}`}>
							<div className={s.cardBody}>
								<div className={s.cardLabel}>Plan settings</div>
								<p className={s.cardDesc}>{settingsMeta}</p>
							</div>
							<PlanModal currentTier={plan} />
						</div>
					</div>

					{/* Usage */}
					<Section title="Usage" />
					<div className={s.tiles}>
						<div className={s.tile}>
							<div className={s.tileLabel}>
								Decoded events today
								<span
									className={s.info}
									title="Decoded events returned to you across Index reads since 00:00 UTC"
								>
									i
								</span>
							</div>
							<div className={s.tileValue}>
								{decodedToday[0]}
								{decodedToday[1] && (
									<span className={s.unit}>{decodedToday[1]}</span>
								)}
							</div>
						</div>
						<div className={s.tile}>
							<div className={s.tileLabel}>
								Decoded events in {monthLabel}
								<span
									className={s.info}
									title="Decoded events returned to you across Index reads this billing period"
								>
									i
								</span>
							</div>
							<div className={s.tileValue}>
								{decodedMonth[0]}
								{decodedMonth[1] && (
									<span className={s.unit}>{decodedMonth[1]}</span>
								)}
							</div>
						</div>
						<div className={s.tile}>
							<div className={s.tileLabel}>
								Subgraphs
								<span
									className={s.info}
									title="Deployed subgraphs vs your plan's slot limit. Subgraphs are slot-gated, not usage-metered."
								>
									i
								</span>
							</div>
							<div className={s.tileValue}>{slotsValue}</div>
						</div>
						<div className={s.tile}>
							<div className={s.tileLabel}>
								Next invoice
								<span
									className={s.info}
									title="Projected charge at the end of this period"
								>
									i
								</span>
							</div>
							<div className={s.tileValue}>{nextInvoice}</div>
						</div>
					</div>

					{/* Spend budget — only when a cap is set */}
					{capPct != null && (
						<>
							<Section title="Usage budget" />
							<div className={s.budget}>
								<div className={s.budgetTop}>
									<span>Spend this period</span>
									<span className={s.budgetAmt}>
										{formatCents(currentCents)}
										<span className={s.muted}>
											{" / "}
											{formatCents(capCents ?? 0)} cap
										</span>
									</span>
								</div>
								<div className={s.bar}>
									<i
										className={frozen ? s.barFrozen : ""}
										style={{ width: `${capPct}%` }}
									/>
								</div>
								<div className={s.budgetMeta}>
									{frozen
										? "Spend frozen — raise your cap to resume."
										: `Projected ${nextInvoice} this period.`}
								</div>
							</div>
						</>
					)}

					{/* Current-period line items */}
					<Section title={`${monthYear} usage`} />
					<div className={s.ledger}>
						<table className={s.table}>
							<thead>
								<tr>
									<th>Description</th>
									<th className={s.numTh}>Amount</th>
									<th className={s.numTh}>Cost</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>{planName} plan — subscription</td>
									<td className={s.num}>monthly</td>
									<td className={`${s.num} ${s.cost}`}>
										{formatCents(currentCents)}
									</td>
								</tr>
								<tr>
									<td>Decoded events returned</td>
									<td className={s.num}>
										{compactStr(
											productUsage?.index.decodedEventsThisMonth ?? 0,
										)}
									</td>
									<td className={s.num}>included</td>
								</tr>
								<tr>
									<td>Streams events delivered</td>
									<td className={s.num}>
										{compactStr(productUsage?.streams.eventsThisMonth ?? 0)}
									</td>
									<td className={s.num}>included</td>
								</tr>
							</tbody>
						</table>
						<div className={s.total}>
							<span className={s.totalK}>Total</span>
							<span className={s.totalV}>{formatCents(currentCents)}</span>
						</div>
					</div>

					{/* Prepaid credits */}
					<Suspense fallback={null}>
						<CreditsTopup
							balanceUsdMicros={status.creditsUsdMicros}
							spentThisMonthUsdMicros={status.creditsSpentThisMonthUsdMicros}
						/>
					</Suspense>

					{/* Statements — real invoices live in the Stripe portal */}
					<Section title="Statements" />
					{sub !== null ? (
						<p className={s.more}>
							Invoices and receipts live in the Stripe customer portal — open it
							from <b>Manage subscription</b> below.
						</p>
					) : (
						<p className={s.more}>
							No statements yet. Your first invoice posts when you move to a
							paid plan. On Free, you pay only for prepaid credits you add
							above.
						</p>
					)}

					{/* Manage / cancel / resume + post-checkout resolve */}
					<Suspense fallback={null}>
						<BillingActions state={state} hasSubscription={sub !== null} />
					</Suspense>

					{state === "free" && (
						<div className={s.anno}>
							you may never need this page. that's the point.
						</div>
					)}
				</div>
			</div>
		</>
	);
}
