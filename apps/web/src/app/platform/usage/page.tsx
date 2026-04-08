import { OverviewTopbar } from "@/components/console/overview-topbar";
import { Sparkline } from "@/components/console/sparkline";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { formatBytes, formatNum } from "@/lib/format";

interface DailyUsage {
	date: string;
	apiRequests: number;
	deliveries: number;
}

interface UsageData {
	plan: string;
	limits: {
		streams: number;
		subgraphs: number;
		apiRequestsPerDay: number;
		deliveriesPerMonth: number;
		storageBytes: number;
	};
	current: {
		streams: number;
		subgraphs: number;
		apiRequestsToday: number;
		deliveriesThisMonth: number;
		storageBytes: number;
	};
	daily?: DailyUsage[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayLabel(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	const today = new Date();
	if (d.toDateString() === today.toDateString()) return "Today";
	return DAY_NAMES[d.getDay()];
}

function pct(current: number, limit: number) {
	if (limit <= 0) return 0;
	return Math.min((current / limit) * 100, 100);
}

export default async function UsagePage() {
	const session = await getSessionFromCookies();
	let usage: UsageData | null = null;

	if (session) {
		try {
			usage = await apiRequest<UsageData>("/api/accounts/usage", {
				sessionToken: session,
			});
		} catch {}
	}

	if (!usage) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Usage" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Usage</h1>
						<p className="settings-desc">Unable to load usage data.</p>
					</div>
				</div>
			</>
		);
	}

	const sparkData = (usage.daily ?? []).map((d) => ({
		label: formatDayLabel(d.date),
		value: d.apiRequests,
	}));

	return (
		<>
			<OverviewTopbar path="Settings" page="Usage" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Usage</h1>
					<p className="settings-desc">Resource consumption for the current billing period.</p>

					{/* Stat cards */}
					<div className="usage-stat-grid">
						<div className="usage-stat">
							<div className="usage-stat-label">Events Indexed</div>
							<div className="usage-stat-value">{formatNum(usage.current.deliveriesThisMonth)}</div>
							<div className="usage-stat-sub">of {formatNum(usage.limits.deliveriesPerMonth)} included</div>
						</div>
						<div className="usage-stat">
							<div className="usage-stat-label">API Requests</div>
							<div className="usage-stat-value">{formatNum(usage.current.apiRequestsToday)}</div>
							<div className="usage-stat-sub">of {formatNum(usage.limits.apiRequestsPerDay)} / day</div>
						</div>
						<div className="usage-stat">
							<div className="usage-stat-label">Storage</div>
							<div className="usage-stat-value">{formatBytes(usage.current.storageBytes)}</div>
							<div className="usage-stat-sub">of {formatBytes(usage.limits.storageBytes)}</div>
						</div>
					</div>

					{/* Sparkline */}
					{sparkData.length > 0 && (
						<div className="settings-section">
							<div className="settings-section-title">API calls — last 7 days</div>
							<Sparkline data={sparkData} />
						</div>
					)}

					{/* Resource limits */}
					<div className="settings-section">
						<div className="settings-section-title">Resource limits</div>

						<div className="usage-row">
							<div className="usage-label">
								<span className="usage-label-name">Streams</span>
								<span className="usage-label-value">{usage.current.streams} / {usage.limits.streams}</span>
							</div>
							<div className="usage-bar">
								<div className="usage-bar-fill accent" style={{ width: `${pct(usage.current.streams, usage.limits.streams)}%` }} />
							</div>
						</div>

						<div className="usage-row">
							<div className="usage-label">
								<span className="usage-label-name">Subgraphs</span>
								<span className="usage-label-value">{usage.current.subgraphs} / {usage.limits.subgraphs}</span>
							</div>
							<div className="usage-bar">
								<div className="usage-bar-fill accent" style={{ width: `${pct(usage.current.subgraphs, usage.limits.subgraphs)}%` }} />
							</div>
						</div>

						<div className="usage-row">
							<div className="usage-label">
								<span className="usage-label-name">Storage</span>
								<span className="usage-label-value">{formatBytes(usage.current.storageBytes)} / {formatBytes(usage.limits.storageBytes)}</span>
							</div>
							<div className="usage-bar">
								<div className="usage-bar-fill green" style={{ width: `${pct(usage.current.storageBytes, usage.limits.storageBytes)}%` }} />
							</div>
						</div>
					</div>

					<div className="settings-divider" />

					{/* Plan */}
					<div className="settings-section">
						<div className="settings-section-title">Plan</div>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 8 }}>
							<div>
								<div style={{ fontSize: 13, fontWeight: 500 }}>{usage.plan}</div>
								<div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
									{usage.limits.streams} streams, {usage.limits.subgraphs} subgraphs, {formatNum(usage.limits.apiRequestsPerDay)} API req/day
								</div>
							</div>
							<button type="button" className="settings-btn ghost">Manage plan</button>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
