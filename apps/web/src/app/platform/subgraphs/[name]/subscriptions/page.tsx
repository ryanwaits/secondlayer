import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { PromptActions } from "@/components/console/prompt-actions";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { ApiError, getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";

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

export default async function SubgraphSubscriptionsPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let subs: SubscriptionSummary[] = [];
	let allSubgraphs: SubgraphSummary[] = [];

	try {
		const [subsResult, listResult] = await Promise.allSettled([
			fetchFromTenantOrThrow<{ data: SubscriptionSummary[] }>(
				session,
				"/api/subscriptions",
			),
			fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			),
		]);
		if (subsResult.status === "fulfilled") {
			subs = subsResult.value.data.filter((s) => s.subgraphName === name);
		}
		allSubgraphs =
			listResult.status === "fulfilled" ? listResult.value.data : [];
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const dropdownItems = allSubgraphs.map((sg) => ({
		name: sg.name,
		href: `/subgraphs/${sg.name}`,
	}));
	const knownTables = allSubgraphs.find((sg) => sg.name === name)?.tables ?? [];

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link
							href="/subgraphs"
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subgraphs
						</Link>
						{" / "}
						<BreadcrumbDropdown
							current={name}
							items={dropdownItems}
							allHref="/subgraphs"
							allLabel="View all subgraphs"
						/>
					</>
				}
				page={
					<Link
						href={`/subgraphs/${name}/subscriptions`}
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Subscriptions
					</Link>
				}
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
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No subscriptions yet</h1>
							<p className="empty-desc">
								Subscriptions deliver typed subgraph events to webhooks —
								Inngest, Trigger.dev, Cloudflare Workflows, or any HTTPS
								endpoint. The agent already knows this subgraph and its tables.
							</p>
							<PromptActions
								prompt={getAgentPrompt("subscription-create", {
									subgraphName: name,
									tables: knownTables,
								})}
							/>
							<div className="empty-divider">
								<span className="empty-divider-text">Get started</span>
							</div>
							<div style={{ marginTop: 16 }}>
								<code
									style={{
										display: "inline-block",
										fontSize: 12,
										background: "var(--code-bg)",
										padding: "8px 12px",
										borderRadius: 4,
									}}
								>
									sl create subscription &lt;name&gt; --runtime
									&lt;inngest|trigger|cloudflare|node&gt;
								</code>
							</div>
						</div>
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
