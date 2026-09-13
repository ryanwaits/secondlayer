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

export default async function SubgraphSubscriptionsPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;

	let subs: SubscriptionSummary[] = [];

	const [subsResult] = await Promise.allSettled([
		apiRequest<{ data: SubscriptionSummary[] }>("/api/subscriptions"),
	]);
	if (subsResult.status === "fulfilled") {
		subs = subsResult.value.data.filter((s) => s.subgraphName === name);
	}

	return (
		<>
			<OverviewTopbar
				crumbs={[
					{ label: "subgraphs", href: "/subgraphs" },
					{ label: name, href: `/subgraphs/${name}` },
					{ label: "subscriptions" },
				]}
			/>
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
							command={`secondlayer subscriptions create <name> --subgraph ${name} --runtime <inngest|trigger|cloudflare|node>`}
							docHref="https://www.secondlayer.tools/docs/subscriptions"
							docLabel="Subscriptions guide →"
							ghostRows={3}
						/>
					) : (
						<table className="index-table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Table</th>
									<th>Format</th>
									<th>Runtime</th>
									<th>Status</th>
									<th>Last delivery</th>
								</tr>
							</thead>
							<tbody>
								{subs.map((s) => (
									<tr key={s.id}>
										<td>
											<Link href={`/subgraphs/${name}/subscriptions/${s.id}`}>
												{s.name}
											</Link>
										</td>
										<td>
											<code>{s.tableName}</code>
										</td>
										<td>
											<code>{s.format}</code>
										</td>
										<td>{s.runtime ?? "—"}</td>
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
