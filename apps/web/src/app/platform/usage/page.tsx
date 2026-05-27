import { AxisCard } from "@/components/console/axis-card";
import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { ProjectUsageTable } from "@/components/console/project-usage-table";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import {
	type UsageResponse,
	formatBytes,
	formatHours,
	formatNum,
} from "@/lib/usage";

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

export default async function ResourcesPage() {
	const session = await getSessionFromCookies();
	let usage: UsageResponse | null = null;
	let productUsage: ProductUsageResponse | null = null;

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

	const { period, compute, storage, projects } = usage;
	const periodLabel = formatPeriod(period.startIso, period.endIso);

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
						Resource consumption ·{" "}
						<span className="period-chip">
							<span className="dot" />
							{periodLabel}
							{period.daysRemaining > 0
								? ` · ${period.daysRemaining} days remaining`
								: " · last day"}
						</span>
					</p>

					<div className="axis-grid">
						<AxisCard
							label="Compute"
							value={formatHours(compute.usedHours)}
							unit="h"
							of="unmetered"
							pct={compute.pct}
							sparkData={compute.sparkline}
							color="accent"
							hidePct
						/>
						<AxisCard
							label="Storage"
							value={formatBytes(storage.usedBytes)}
							of="unmetered"
							pct={storage.pct}
							sparkData={storage.sparkline}
							color="accent"
							hidePct
						/>
					</div>

					{productUsage && <ProductUsageSection usage={productUsage} />}

					<div className="settings-section">
						<div className="settings-section-title">
							Projects ({projects.length})
						</div>
						<ProjectUsageTable projects={projects} />
					</div>

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Plan</div>
						<div className="plan-card">
							<div>
								<div className="plan-card-name">
									Open beta <span className="tier-badge">free</span>
								</div>
								<div className="plan-card-sub">
									Everything is free while Secondlayer is in beta — no limits,
									no charges. Paid plans with higher dedicated resources are
									coming later.
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
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: 12,
				}}
			>
				<div className="plan-card" style={{ display: "block", padding: 14 }}>
					<div className="plan-card-name">
						Stacks Streams{" "}
						<span className="tier-badge">{usage.streams.tier}</span>
					</div>
					<div
						className="plan-card-sub"
						style={{ marginTop: 6, lineHeight: 1.6 }}
					>
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
				<div className="plan-card" style={{ display: "block", padding: 14 }}>
					<div className="plan-card-name">
						Stacks Index <span className="tier-badge">{usage.index.tier}</span>
					</div>
					<div
						className="plan-card-sub"
						style={{ marginTop: 6, lineHeight: 1.6 }}
					>
						<div>
							{indexRate === null
								? "Unlimited req/s"
								: indexRate === 0
									? "API access requires Build+"
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
