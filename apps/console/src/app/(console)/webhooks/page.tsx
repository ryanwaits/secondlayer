import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import type { WebhookSummary } from "@/lib/types";
import Link from "next/link";

function statusBadge(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

/**
 * Instance-wide webhooks index — the sidebar's third surface. Every row
 * links into its subgraph-scoped detail screen, where the delivery log, DLQ,
 * diagnostics, and replay live.
 */
export default async function WebhooksPage() {
	let subs: WebhookSummary[] = [];
	try {
		const res = await apiRequest<{ data: WebhookSummary[] }>("/api/webhooks");
		subs = res.data;
	} catch {
		subs = [];
	}

	return (
		<>
			<OverviewTopbar crumbs={[{ label: "webhooks" }]} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="index-header">
						<div>
							<span className="index-title">Webhooks</span>
							<span className="index-count">
								{subs.length} webhook{subs.length !== 1 ? "s" : ""}
							</span>
						</div>
					</div>

					{subs.length === 0 ? (
						<EmptyState
							title="No webhooks yet"
							message="Webhooks deliver typed subgraph events to webhooks — Inngest, Trigger.dev, Cloudflare Workflows, or any HTTPS endpoint."
							command="secondlayer webhooks create <name> --subgraph <subgraph> --runtime <inngest|trigger|cloudflare|node>"
							docHref="https://www.secondlayer.tools/docs/webhooks"
							docLabel="Webhooks guide →"
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
												href={`/subgraphs/${s.subgraphName}/webhooks/${s.id}`}
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
