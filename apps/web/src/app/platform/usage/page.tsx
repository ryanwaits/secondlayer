import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { type UsageResponse, formatCents, formatNum } from "@/lib/usage";
import Link from "next/link";

type ProductUsageResponse = {
	streams: {
		tier: "free" | "build" | "scale" | "enterprise";
		rateLimitPerSecond: number | null;
		retentionDays: number | null;
		eventsToday: number;
		eventsThisMonth: number;
	};
	index: {
		tier: "free" | "build" | "scale" | "enterprise";
		rateLimitPerSecond: number | null;
		decodedEventsToday: number;
		decodedEventsThisMonth: number;
	};
};

/** One taxonomy for every tier badge — product tiers (free/build/scale/…) and
 *  plan tiers (none/launch/scale/…) both resolve to the plan-facing name. */
function tierLabel(t: string): string {
	switch (t) {
		case "free":
		case "none":
			return "Free";
		case "build":
		case "launch":
			return "Pro";
		case "scale":
			return "Scale";
		case "enterprise":
			return "Enterprise";
		default:
			return t.charAt(0).toUpperCase() + t.slice(1);
	}
}

export default async function ResourcesPage() {
	const session = await getSessionFromCookies();
	let usage: UsageResponse | null = null;
	let productUsage: ProductUsageResponse | null = null;
	let creditsUsdMicros = "0";

	if (session) {
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
		try {
			const bs = await apiRequest<{ creditsUsdMicros: string }>(
				"/api/billing/status",
				{ sessionToken: session },
			);
			creditsUsdMicros = bs.creditsUsdMicros ?? "0";
		} catch {}
	}

	if (!usage) {
		return (
			<>
				<OverviewTopbar
					path={<SettingsCrumb />}
					page="Resources"
					showRefresh={false}
				/>
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Resources</h1>
						<p className="settings-desc">Unable to load resource data.</p>
					</div>
				</div>
			</>
		);
	}

	const { period, plan, spend } = usage;
	const periodLabel = formatPeriod(period.startIso, period.endIso);
	// credits are USD micros (1e6 = $1) → cents for the shared formatter.
	const creditsCents = Math.round(Number(creditsUsdMicros) / 10_000);
	const capPct =
		spend.capCents && spend.capCents > 0
			? Math.min(100, Math.round((spend.currentCents / spend.capCents) * 100))
			: null;

	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Resources"
				showRefresh={false}
			/>
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Resources</h1>
					<p className="settings-desc">
						Usage, limits, and spend ·{" "}
						<span className="period-chip">
							<span className="dot" />
							{periodLabel}
							{period.daysRemaining > 0
								? ` · ${period.daysRemaining} days remaining`
								: " · last day"}
						</span>
					</p>

					{/* Budget — spend vs cap + prepaid credits */}
					<div className="settings-section">
						<div className="settings-section-title">Usage budget</div>
						<div className="usage-budget">
							<div className="usage-budget-top">
								<span>Spend this period</span>
								<span className="usage-budget-amt">
									{formatCents(spend.currentCents)}
									{spend.capCents != null && (
										<span className="muted">
											{" "}
											/ {formatCents(spend.capCents)} cap
										</span>
									)}
								</span>
							</div>
							{capPct != null && (
								<div className="usage-bar">
									<i
										className={
											spend.frozen ? "frozen" : spend.thresholdHit ? "warn" : ""
										}
										style={{ width: `${capPct}%` }}
									/>
								</div>
							)}
							<div className="usage-budget-meta">
								{spend.frozen ? (
									<span className="usage-warn">
										Spend frozen — raise your cap on{" "}
										<Link href="/platform/billing">Billing</Link> to resume.
									</span>
								) : spend.capCents != null ? (
									<>
										Projected {formatCents(spend.projectedCents)} · alerts at{" "}
										{spend.thresholdPct}%
									</>
								) : (
									<>
										No spend cap set ·{" "}
										<Link href="/platform/billing">set one on Billing →</Link>
									</>
								)}
							</div>
						</div>
						<div className="usage-grid">
							<div className="plan-card usage-tile">
								<div className="plan-card-name">Credits</div>
								<div className="plan-card-sub usage-tile-sub">
									<strong>{formatCents(creditsCents)}</strong> remaining ·{" "}
									<Link href="/platform/billing">Top up →</Link>
								</div>
							</div>
							<div className="plan-card usage-tile">
								<div className="plan-card-name">Draws down on</div>
								<div className="plan-card-sub usage-tile-sub">
									reads + indexing beyond the free floor
								</div>
							</div>
						</div>
					</div>

					{productUsage && <ProductUsageSection usage={productUsage} />}

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Plan</div>
						<div className="plan-card">
							<div>
								<div className="plan-card-name">
									{plan.name}{" "}
									<span className="tier-badge">{tierLabel(plan.tier)}</span>
								</div>
								<div className="plan-card-sub">
									{plan.basePriceUsd > 0
										? `$${plan.basePriceUsd}/mo · manage on the billing page.`
										: "Free tier — keyless reads included; you pay only when you host or exceed the free floor."}{" "}
									<Link href="/platform/billing">Billing →</Link>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

// ── Inlined subcomponents ──────────────────────────────────────────

function ProductUsageSection({ usage }: { usage: ProductUsageResponse }) {
	const streamsRate = usage.streams.rateLimitPerSecond;
	const indexRate = usage.index.rateLimitPerSecond;
	return (
		<div className="settings-section">
			<div className="settings-section-title">Streams &amp; Index</div>
			<div className="usage-grid">
				<div className="plan-card usage-tile">
					<div className="plan-card-name">
						Streams{" "}
						<span className="tier-badge">{tierLabel(usage.streams.tier)}</span>
					</div>
					<div className="plan-card-sub usage-tile-sub">
						<div>
							{streamsRate === null
								? "Unlimited req/s"
								: `${formatNum(streamsRate)} req/s`}{" "}
							·{" "}
							{usage.streams.retentionDays === null
								? "full archive"
								: `${usage.streams.retentionDays} day window`}
						</div>
						<div>
							<strong>{formatNum(usage.streams.eventsToday)}</strong> events
							today
						</div>
						<div>
							<strong>{formatNum(usage.streams.eventsThisMonth)}</strong> events
							this period
						</div>
					</div>
				</div>
				<div className="plan-card usage-tile">
					<div className="plan-card-name">
						Index{" "}
						<span className="tier-badge">{tierLabel(usage.index.tier)}</span>
					</div>
					<div className="plan-card-sub usage-tile-sub">
						<div>
							{indexRate === null
								? "Unlimited req/s"
								: `${formatNum(indexRate)} req/s`}
						</div>
						<div>
							<strong>{formatNum(usage.index.decodedEventsToday)}</strong>{" "}
							decoded events today
						</div>
						<div>
							<strong>{formatNum(usage.index.decodedEventsThisMonth)}</strong>{" "}
							decoded events this period
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatPeriod(startIso: string, endIso: string): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const m = (d: Date) =>
		d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
	const day = (d: Date) => d.getUTCDate();
	return `${m(start)} ${day(start)} – ${m(end)} ${day(end)}`;
}
