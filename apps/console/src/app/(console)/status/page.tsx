import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { StatusReport } from "@/lib/types";

/**
 * Instance status — a quiet render of `GET /status`: overall verdict, chain
 * tip, node lag, and the per-service health rows. Nothing here is computed
 * client-side or fabricated; fields the runtime omits simply don't render.
 */

function serviceBadge(status: string): string {
	if (status === "ok") return "active";
	if (status === "degraded") return "warn";
	return "error";
}

export default async function StatusPage() {
	let report: StatusReport | null = null;
	try {
		report = await apiRequest<StatusReport>("/status");
	} catch {
		report = null;
	}

	const lagSeconds = report?.streams?.tip?.lag_seconds ?? null;
	const services = report?.services ?? [];
	const checked = report?.timestamp ? timeAgo(report.timestamp) : null;

	return (
		<>
			<OverviewTopbar crumbs={[{ label: "status" }]} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="ident">
						<h2>Status</h2>
						{report && (
							<span
								className={`verdict ${report.status === "healthy" ? "ok" : "warn"}`}
							>
								{report.status}
							</span>
						)}
						{report?.network && (
							<span className="kv">
								network <b>{report.network}</b>
							</span>
						)}
					</div>

					{report === null ? (
						<EmptyState message="Instance unreachable — is the runtime up and SL_API_URL pointed at it?" />
					) : (
						<>
							<div className="meta">
								{report.chainTip != null && (
									<div className="meta-card">
										<div className="ov-label">Chain tip</div>
										<div className="meta-v mono">
											#{report.chainTip.toLocaleString()}
										</div>
									</div>
								)}
								{lagSeconds != null && (
									<div className="meta-card">
										<div className="ov-label">Node lag</div>
										<div className="meta-v mono">{lagSeconds}s</div>
									</div>
								)}
								{report.activeSubgraphs != null && (
									<div className="meta-card">
										<div className="ov-label">Active subgraphs</div>
										<div className="meta-v mono">{report.activeSubgraphs}</div>
									</div>
								)}
								{checked && (
									<div className="meta-card">
										<div className="ov-label">Checked</div>
										<div className="meta-v mono">{checked}</div>
									</div>
								)}
							</div>

							{services.length > 0 && (
								<section className="sg-sec">
									<div className="sg-sec-head">
										<span className="t">
											Services<span className="cnt">{services.length}</span>
										</span>
									</div>
									<div className="dash-led">
										{services.map((s) => (
											<div key={s.name} className="dash-led-row">
												<span className="dash-led-name">{s.name}</span>
												<span className={`badge ${serviceBadge(s.status)}`}>
													{s.status}
												</span>
											</div>
										))}
									</div>
								</section>
							)}
						</>
					)}
				</div>
			</div>
		</>
	);
}
