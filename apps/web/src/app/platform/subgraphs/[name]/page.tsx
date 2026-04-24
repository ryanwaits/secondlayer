import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { PromptActions } from "@/components/console/prompt-actions";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { ApiKey, SubgraphDetail, SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenInChat } from "./open-in-chat";
import { SubgraphReindexForm } from "./reindex-form";
import { SubgraphTablesBrowser } from "./tables-browser";
import { SubgraphUrlSection } from "./url-section";

interface SubscriptionSummary {
	id: string;
	name: string;
	status: "active" | "paused" | "error";
	subgraphName: string;
	circuitOpenedAt: string | null;
	lastDeliveryAt: string | null;
}

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "syncing" || status === "reindexing") return "syncing";
	return "error";
}

export default async function SubgraphDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();

	let subgraph: SubgraphDetail;
	let allSubgraphs: SubgraphSummary[] = [];

	try {
		if (!session) notFound();
		const [sgResult, listResult] = await Promise.allSettled([
			fetchFromTenantOrThrow<SubgraphDetail>(session, `/api/subgraphs/${name}`),
			fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			),
		]);

		if (sgResult.status === "rejected") {
			if (sgResult.reason instanceof ApiError && sgResult.reason.status === 404)
				notFound();
			throw sgResult.reason;
		}
		subgraph = sgResult.value;
		allSubgraphs =
			listResult.status === "fulfilled" ? listResult.value.data : [];
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const keysResult = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
		sessionToken: session ?? undefined,
		tags: ["keys"],
	}).catch(() => ({ keys: [] as ApiKey[] }));

	// Subscriptions summary for this subgraph
	let subsForSubgraph: SubscriptionSummary[] = [];
	try {
		const subsResult = await fetchFromTenantOrThrow<{
			data: SubscriptionSummary[];
		}>(session, "/api/subscriptions");
		subsForSubgraph = subsResult.data.filter((s) => s.subgraphName === name);
	} catch {
		subsForSubgraph = [];
	}
	const subsCount = subsForSubgraph.length;
	const circuitPausedCount = subsForSubgraph.filter(
		(s) => s.circuitOpenedAt !== null,
	).length;
	const activeCount = subsForSubgraph.filter(
		(s) => s.status === "active",
	).length;

	const primaryKey = keysResult.keys
		.filter((k) => k.status === "active")
		.sort((a, b) => {
			if (a.lastUsedAt && b.lastUsedAt)
				return (
					new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
				);
			if (a.lastUsedAt) return -1;
			if (b.lastUsedAt) return 1;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		})[0];

	const tableEntries = Object.entries(subgraph.tables);
	const totalRows = tableEntries.reduce((sum, [, t]) => sum + t.rowCount, 0);
	const displayStatus = getDisplayStatus(
		{
			...subgraph,
			totalProcessed: subgraph.health.totalProcessed,
			totalErrors: subgraph.health.totalErrors,
			tables: Object.keys(subgraph.tables),
			createdAt: "",
		},
		subgraph.lastProcessedBlock,
	);

	const { totalProcessed, totalErrors } = subgraph.health;
	const uptime =
		totalProcessed > 0
			? `${(((totalProcessed - totalErrors) / totalProcessed) * 100).toFixed(1)}%`
			: "—";

	const { blocksRemaining } = subgraph.sync;
	const lagSeconds = blocksRemaining * 10;
	const latency =
		blocksRemaining === 0
			? "synced"
			: lagSeconds >= 600
				? `~${Math.round(lagSeconds / 60)}m`
				: `~${lagSeconds}s`;

	const dropdownItems = allSubgraphs.map((sg) => ({
		name: sg.name,
		href: `/subgraphs/${sg.name}`,
	}));

	return (
		<>
			<OverviewTopbar
				path={
					<Link
						href="/subgraphs"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Subgraphs
					</Link>
				}
				page={
					<BreadcrumbDropdown
						current={name}
						items={dropdownItems}
						allHref="/subgraphs"
						allLabel="View all subgraphs"
					/>
				}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Open in chat CTA */}
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							marginBottom: 12,
						}}
					>
						<OpenInChat subgraphName={name} />
					</div>

					{/* Metadata cards */}
					<MetaGrid
						items={[
							{
								label: "Base URL",
								value: "https://api.secondlayer.tools/api/subgraphs",
								mono: true,
								tooltip: "Base URL for all REST queries against this subgraph",
								copyValue: "https://api.secondlayer.tools/api/subgraphs",
								span: 2,
							},
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(displayStatus)}`}>
										{displayStatus}
									</span>
								),
								tooltip: "Current indexing state of this subgraph",
							},
							{
								label: "Version",
								value: `v${subgraph.version}`,
								mono: true,
								tooltip: "Current deployed version of this subgraph",
							},
							{
								label: "Last Indexed Block",
								value: subgraph.lastProcessedBlock
									? `#${subgraph.lastProcessedBlock.toLocaleString()}`
									: "—",
								mono: true,
								tooltip:
									"Most recent block processed by this subgraph. May lag behind chain tip while catching up.",
							},
							{
								label: "Total Rows",
								value: totalRows.toLocaleString(),
								tooltip: "Total records across all tables in this subgraph",
							},
							{
								label: "Latency",
								value: latency,
								tooltip:
									"Estimated time behind chain tip, based on blocks remaining × ~10s avg block time",
							},
							{
								label: "Uptime",
								value: uptime,
								tooltip:
									"Percentage of blocks processed without error — (processed − errors) / processed",
							},
						]}
					/>

					<SubgraphUrlSection
						tables={subgraph.tables}
						apiKeyPrefix={primaryKey?.prefix}
					/>

					{/* Tables (merged schema + data) */}
					{tableEntries.length > 0 && (
						<SubgraphTablesBrowser
							subgraphName={name}
							tables={subgraph.tables}
							sessionToken={session ?? ""}
						/>
					)}

					{/* Subscriptions summary */}
					<DetailSection
						title="Subscriptions"
						actions={
							subsCount > 0 ? (
								<Link
									href={`/subgraphs/${name}/subscriptions`}
									className="btn-secondary"
								>
									View all →
								</Link>
							) : undefined
						}
					>
						{subsCount === 0 ? (
							<>
								<p className="detail-desc">
									No subscriptions attached to this subgraph. Create a receiver
									and webhook for one of its tables.
								</p>
								<PromptActions
									prompt={getAgentPrompt("subscription-create", {
										subgraphName: name,
										tables: Object.keys(subgraph.tables),
									})}
								/>
							</>
						) : (
							<p className="detail-desc">
								<Link href={`/subgraphs/${name}/subscriptions`}>
									{subsCount} subscription{subsCount !== 1 ? "s" : ""}
								</Link>{" "}
								· {activeCount} active · {circuitPausedCount} circuit-paused
							</p>
						)}
					</DetailSection>

					{/* Backfill / Reindex */}
					<DetailSection title="Backfill &amp; Reindex">
						<SubgraphReindexForm
							subgraphName={name}
							sessionToken={session ?? ""}
						/>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
