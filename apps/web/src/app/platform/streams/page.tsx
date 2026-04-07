import { IndexRow } from "@/components/console/index-row";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Stream } from "@/lib/types";
import Link from "next/link";

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	if (status === "failed" || status === "inactive") return "error";
	return "";
}

export default async function StreamsPage() {
	const session = await getSessionFromCookies();
	let streams: Stream[] = [];

	if (session) {
		try {
			const data = await apiRequest<{ streams: Stream[]; total: number }>(
				"/api/streams?limit=100&offset=0",
				{ sessionToken: session, tags: ["streams"] },
			);
			streams = data.streams;
		} catch {}
	}

	return (
		<>
			<OverviewTopbar
					page="Streams"
					lastUpdated={streams.length > 0
						? streams.reduce((latest, st) => st.updatedAt > latest ? st.updatedAt : latest, streams[0].updatedAt)
						: null}
				/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{streams.length > 0 && (
						<div className="index-header">
							<div>
								<span className="index-title">Streams</span>
								<span className="index-count">
									{streams.length} stream{streams.length !== 1 ? "s" : ""}
								</span>
							</div>
						</div>
					)}

					{streams.length === 0 ? (
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No streams yet</h1>
							<p className="empty-desc">
								Streams deliver real-time blockchain events to your
								webhook endpoints. Create one from your terminal or SDK.
							</p>
							<div className="empty-divider">
								<span className="empty-divider-text">Get started</span>
							</div>
							<div className="empty-cards">
								<div className="empty-card">
									<div className="empty-card-preview">
										<div className="empty-card-preview-art">
											<svg width="120" height="60" viewBox="0 0 120 60" fill="none" aria-hidden="true">
												<rect x="8" y="8" width="10" height="4" rx="1" fill="currentColor" opacity="0.4" />
												<rect x="22" y="8" width="40" height="4" rx="1" fill="currentColor" opacity="0.2" />
												<rect x="8" y="18" width="10" height="4" rx="1" fill="currentColor" opacity="0.4" />
												<rect x="22" y="18" width="32" height="4" rx="1" fill="currentColor" opacity="0.2" />
												<rect x="8" y="28" width="10" height="4" rx="1" fill="currentColor" opacity="0.4" />
												<rect x="22" y="28" width="50" height="4" rx="1" fill="currentColor" opacity="0.15" />
												<rect x="8" y="38" width="60" height="4" rx="1" fill="currentColor" opacity="0.1" />
											</svg>
										</div>
										<div className="empty-card-icon">
											<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
												<path d="M4 5l3 3-3 3" />
												<path d="M9 11h4" />
											</svg>
										</div>
									</div>
									<div className="empty-card-body">
										<div className="empty-card-title">Use the CLI</div>
										<div className="empty-card-desc">
											Run <code style={{ fontSize: 12, background: "var(--code-bg)", padding: "1px 5px", borderRadius: 3 }}>npx secondlayer stream create</code> to
											configure and deploy a stream from your terminal.
										</div>
									</div>
								</div>
								<div className="empty-card">
									<div className="empty-card-preview">
										<div className="empty-card-preview-art">
											<svg width="120" height="60" viewBox="0 0 120 60" fill="none" aria-hidden="true">
												<circle cx="20" cy="20" r="6" fill="currentColor" opacity="0.15" />
												<circle cx="60" cy="30" r="6" fill="currentColor" opacity="0.15" />
												<circle cx="100" cy="20" r="6" fill="currentColor" opacity="0.15" />
												<path d="M26 20 L54 30" stroke="currentColor" strokeWidth="1" opacity="0.2" />
												<path d="M66 30 L94 20" stroke="currentColor" strokeWidth="1" opacity="0.2" />
												<rect x="8" y="42" width="104" height="4" rx="2" fill="currentColor" opacity="0.08" />
											</svg>
										</div>
										<div className="empty-card-icon">
											<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
												<path d="M5 4l-3 4 3 4" />
												<path d="M11 4l3 4-3 4" />
												<path d="M9 2l-2 12" />
											</svg>
										</div>
									</div>
									<div className="empty-card-body">
										<div className="empty-card-title">Use the SDK</div>
										<div className="empty-card-desc">
											Define streams programmatically with the Secondlayer SDK.
											Set filters, endpoints, and retry policies in TypeScript.
										</div>
									</div>
								</div>
							</div>
						</div>
					) : (
						streams.map((st) => {
							const successRate =
								st.totalDeliveries > 0
									? (
											((st.totalDeliveries - st.failedDeliveries) /
												st.totalDeliveries) *
											100
										).toFixed(1)
									: "—";
							return (
								<IndexRow
									key={st.id}
									href={`/streams/${st.id}`}
									name={st.name}
									badge={
										<span className={`badge ${statusBadgeClass(st.status)}`}>
											{st.failedDeliveries > 0 && st.status === "active"
												? `${st.failedDeliveries} failed`
												: st.status}
										</span>
									}
									description={st.endpointUrl}
									stats={[
										{
											label: "deliveries",
											value: `${st.totalDeliveries.toLocaleString()} deliveries`,
										},
										{ label: "success", value: `${successRate}%` },
									]}
								/>
							);
						})
					)}
				</div>
			</div>
		</>
	);
}
