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
			<OverviewTopbar page="Streams" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="index-header">
						<div>
							<span className="index-title">Streams</span>
							<span className="index-count">
								{streams.length} stream{streams.length !== 1 ? "s" : ""}
							</span>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<Link href="/streams" className="index-create-btn">
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
									<path d="M6 2v8M2 6h8" />
								</svg>
								New stream
							</Link>
						</div>
					</div>

					{streams.length === 0 ? (
						<div className="ov-empty">
							No streams yet.{" "}
							<span className="ov-section-link">
								Create your first stream &rarr;
							</span>
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
