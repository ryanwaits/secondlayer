import { OverviewTopbar } from "@/components/console/overview-topbar";
import { getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import Link from "next/link";

interface SubscriptionSummary {
	id: string;
	name: string;
	status: "active" | "paused" | "error";
	subgraphName: string;
	tableName: string;
	format: string;
	runtime: string | null;
	url: string;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	createdAt: string;
	updatedAt: string;
}

function statusBadge(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

export default async function SubscriptionsPage() {
	const session = await getSessionFromCookies();
	let subs: SubscriptionSummary[] = [];

	if (session) {
		try {
			const res = await fetchFromTenantOrThrow<{ data: SubscriptionSummary[] }>(
				session,
				"/api/subscriptions",
			);
			subs = res.data;
		} catch {
			subs = [];
		}
	}

	return (
		<>
			<OverviewTopbar page="Subscriptions" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="index-header">
						<div>
							<span className="index-title">Subscriptions</span>
							<span className="index-count">
								{subs.length} subscription{subs.length !== 1 ? "s" : ""}
							</span>
						</div>
						<Link href="/subscriptions/new" className="btn-primary">
							New subscription
						</Link>
					</div>

					{subs.length === 0 ? (
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No subscriptions yet</h1>
							<p className="empty-desc">
								Subscriptions deliver typed subgraph events to webhooks —
								Inngest, Trigger.dev, Cloudflare Workflows, or any HTTPS
								endpoint.
							</p>
						</div>
					) : (
						<table className="index-table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Source</th>
									<th>Format</th>
									<th>Status</th>
									<th>Last delivery</th>
								</tr>
							</thead>
							<tbody>
								{subs.map((s) => (
									<tr key={s.id}>
										<td>
											<Link href={`/subscriptions/${s.id}`}>{s.name}</Link>
										</td>
										<td>
											<code>
												{s.subgraphName}.{s.tableName}
											</code>
										</td>
										<td>
											<code>{s.format}</code>
										</td>
										<td>
											<span className={`status-badge ${statusBadge(s.status)}`}>
												{s.status}
											</span>
										</td>
										<td>
											{s.lastDeliveryAt
												? new Date(s.lastDeliveryAt).toLocaleString()
												: "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>
		</>
	);
}
