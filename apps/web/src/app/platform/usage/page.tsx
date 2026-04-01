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
	const d = new Date(dateStr + "T00:00:00");
	const today = new Date();
	if (d.toDateString() === today.toDateString()) return "Today";
	return DAY_NAMES[d.getDay()];
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
			<div className="dash-page-header">
				<h1 className="dash-page-title">Usage</h1>
				<p className="dash-page-desc">Unable to load usage data.</p>
			</div>
		);
	}

	const sparkData = (usage.daily ?? []).map((d) => ({
		label: formatDayLabel(d.date),
		value: d.apiRequests,
	}));

	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Usage</h1>
			</div>

			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">Plan</h2>
			</div>
			<div style={{ marginBottom: 16 }}>
				<span className={`dash-badge ${usage.plan}`}>{usage.plan}</span>
			</div>

			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">Resource limits</h2>
			</div>
			<div>
				<div className="limit-row">
					<span className="limit-label">Streams</span>
					<div className="limit-right">
						<span className="limit-value">
							{usage.current.streams} / {usage.limits.streams}
						</span>
						<div className="limit-bar">
							<div
								className="limit-bar-fill"
								style={{
									width: `${(usage.current.streams / usage.limits.streams) * 100}%`,
								}}
							/>
						</div>
					</div>
				</div>
				<div className="limit-row">
					<span className="limit-label">Subgraphs</span>
					<div className="limit-right">
						<span className="limit-value">
							{usage.current.subgraphs} / {usage.limits.subgraphs}
						</span>
						<div className="limit-bar">
							<div
								className="limit-bar-fill"
								style={{
									width: `${(usage.current.subgraphs / usage.limits.subgraphs) * 100}%`,
								}}
							/>
						</div>
					</div>
				</div>
			</div>

			{sparkData.length > 0 && (
				<>
					<div className="dash-section-wrap" style={{ marginTop: 24 }}>
						<hr />
						<h2 className="dash-section-title">API calls — last 7 days</h2>
					</div>
					<Sparkline data={sparkData} />
				</>
			)}

			<div className="dash-section-wrap" style={{ marginTop: 24 }}>
				<hr />
				<h2 className="dash-section-title">This month</h2>
			</div>
			<div>
				<div className="breakdown-row">
					<span className="breakdown-label">API calls</span>
					<span className="breakdown-value">
						{formatNum(usage.current.apiRequestsToday)}
					</span>
				</div>
				<div className="breakdown-row">
					<span className="breakdown-label">Deliveries</span>
					<span className="breakdown-value">
						{formatNum(usage.current.deliveriesThisMonth)}
					</span>
				</div>
				<div className="breakdown-row">
					<span className="breakdown-label">Subgraph data</span>
					<span className="breakdown-value">
						{formatBytes(usage.current.storageBytes)}
					</span>
				</div>
			</div>

			<p className="dash-hint" style={{ marginTop: 12, opacity: 0.7 }}>
				Resource limits apply to creation. API reads are unlimited on all plans.
			</p>
		</>
	);
}
