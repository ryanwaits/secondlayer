import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import Link from "next/link";

export interface SentrySummary {
	id: string;
	account_id: string;
	kind: string;
	name: string;
	config: Record<string, unknown>;
	active: boolean;
	last_check_at: string | null;
	delivery_webhook: string;
	created_at: string;
	updated_at: string;
}

function formatLastCheck(ts: string | null): string {
	if (!ts) return "never";
	const d = new Date(ts);
	const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
	if (diffSec < 60) return `${diffSec}s ago`;
	if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
	if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
	return `${Math.floor(diffSec / 86400)}d ago`;
}

function shortenPrincipal(p: unknown): string {
	if (typeof p !== "string") return "—";
	return p.length > 18 ? `${p.slice(0, 8)}…${p.slice(-6)}` : p;
}

export default async function SentriesPage() {
	const session = await getSessionFromCookies();
	let sentries: SentrySummary[] = [];

	if (session) {
		const result = await apiRequest<{ data: SentrySummary[] }>(
			"/api/sentries",
			{ sessionToken: session, tags: ["sentries"] },
		).catch(() => ({ data: [] as SentrySummary[] }));
		sentries = result.data;
	}

	return (
		<>
			<OverviewTopbar page="Sentries" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{sentries.length > 0 ? (
						<>
							<div className="index-header">
								<div>
									<span className="index-title">Sentries</span>
									<span className="index-count">
										{sentries.length} sentr{sentries.length === 1 ? "y" : "ies"}
									</span>
								</div>
								<Link href="/sentries/new" className="settings-btn primary">
									New sentry
								</Link>
							</div>
							{sentries.map((s) => (
								<Link
									key={s.id}
									href={`/sentries/${s.id}`}
									className="index-row"
								>
									<div className="index-row-main">
										<div className="index-row-name">
											{s.name}
											<span
												className={`badge ${s.active ? "active" : ""}`}
												style={{ marginLeft: 8 }}
											>
												{s.active ? "Active" : "Paused"}
											</span>
										</div>
										<div className="index-row-desc">
											<code>{s.kind}</code> · target{" "}
											<code>{shortenPrincipal(s.config.principal)}</code>
										</div>
									</div>
									<div className="index-row-stats">
										<div className="index-row-stat">
											<span className="index-row-stat-value">
												{formatLastCheck(s.last_check_at)}
											</span>
											<span className="index-row-stat-label">last check</span>
										</div>
									</div>
								</Link>
							))}
						</>
					) : (
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No sentries yet</h1>
							<p className="empty-desc">
								Sentries watch your Stacks contracts in realtime. We triage
								anomalies with AI and page you before exploits compound.
							</p>
							<div style={{ marginTop: 24 }}>
								<Link href="/sentries/new" className="settings-btn primary">
									Enable a sentry
								</Link>
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	);
}
