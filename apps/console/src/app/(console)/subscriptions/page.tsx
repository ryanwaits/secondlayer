import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import type { SubscriptionSummary } from "@/lib/types";
import Link from "next/link";

function statusBadge(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

/**
 * Instance-wide subscriptions index — the sidebar's third surface. Every row
 * links into its subgraph-scoped detail screen, where the delivery log, DLQ,
 * diagnostics, and replay live.
 */
export default async function SubscriptionsPage() {
	let subs: SubscriptionSummary[] = [];
	try {
		const res = await apiRequest<{ data: SubscriptionSummary[] }>(
			"/api/subscriptions",
		);
		subs = res.data;
	} catch {
		subs = [];
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
					</div>

					{subs.length === 0 ? (
						<EmptyState
							title="No subscriptions yet"
							message="Subscriptions deliver typed subgraph events to webhooks — Inngest, Trigger.dev, Cloudflare Workflows, or any HTTPS endpoint."
							command="secondlayer subscriptions create <name> --subgraph <subgraph> --runtime <inngest|trigger|cloudflare|node>"
							docHref="https://www.secondlayer.tools/docs/subscriptions"
							docLabel="Subscriptions guide →"
							ghostRows={3}
						/>
					) : (
						<table className="index-table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Subgraph</th>
									<th>Table</th>
									<th>Format</th>
									<th>Status</th>
									<th>Last delivery</th>
								</tr>
							</thead>
							<tbody>
								{subs.map((s) => (
									<tr key={s.id}>
										<td>
											<Link
												href={`/subgraphs/${s.subgraphName}/subscriptions/${s.id}`}
											>
												{s.name}
											</Link>
										</td>
										<td>
											<Link href={`/subgraphs/${s.subgraphName}`}>
												{s.subgraphName}
											</Link>
										</td>
										<td>
											<code>{s.tableName}</code>
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
