import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { PromptCard } from "@/components/console/prompt-card";
import {
	type ObservedSubscriptionState,
	getAgentPrompt,
} from "@/lib/agent-prompts";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubscriptionDangerZone, SubscriptionSettings } from "./actions";
import { DeliveryLog } from "./delivery-log";
import { Diagnostics } from "./diagnostics";
import { Dlq } from "./dlq";
import { ReplayDialog } from "./replay-dialog";

interface SubscriptionDetail {
	id: string;
	name: string;
	status: "active" | "paused" | "error";
	subgraphName: string;
	tableName: string;
	format: string;
	runtime: string | null;
	url: string;
	filter: Record<string, unknown>;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
}

interface SubscriptionSummary {
	id: string;
	name: string;
	subgraphName: string;
}

interface DeadRow {
	id: string;
	blockHeight: number;
}

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

export default async function SubscriptionDetailPage({
	params,
}: {
	params: Promise<{ name: string; id: string }>;
}) {
	const { name, id } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let sub: SubscriptionDetail;
	let siblings: SubscriptionSummary[] = [];
	let deadRows: DeadRow[] = [];
	// A delivery problem and an indexing problem look identical from the
	// delivery log alone, so diagnostics needs to know whether the source is
	// keeping up. Best-effort: a failed fetch just hides that one chip.
	let sourceLag: { behind: number; tip: number } | null = null;
	try {
		const [detailResult, listResult, deadResult, subgraphResult] =
			await Promise.allSettled([
				apiRequest<SubscriptionDetail>(`/api/subscriptions/${id}`, {
					sessionToken: session,
				}),
				apiRequest<{ data: SubscriptionSummary[] }>("/api/subscriptions", {
					sessionToken: session,
				}),
				apiRequest<{ data: DeadRow[] }>(`/api/subscriptions/${id}/dead`, {
					sessionToken: session,
				}),
				apiRequest<SubgraphDetail>(
					`/api/subgraphs/${encodeURIComponent(name)}`,
					{ sessionToken: session },
				),
			]);
		if (detailResult.status === "rejected") {
			if (
				detailResult.reason instanceof ApiError &&
				detailResult.reason.status === 404
			) {
				notFound();
			}
			throw detailResult.reason;
		}
		sub = detailResult.value;
		if (sub.subgraphName !== name) notFound();
		if (listResult.status === "fulfilled") {
			siblings = listResult.value.data.filter((s) => s.subgraphName === name);
		}
		if (deadResult.status === "fulfilled") {
			deadRows = deadResult.value.data;
		}
		if (subgraphResult.status === "fulfilled") {
			const sg = subgraphResult.value;
			const tip = sg.sync?.chainTip ?? null;
			const indexed = sg.lastProcessedBlock ?? sg.sync?.lastProcessedBlock;
			if (tip != null && indexed != null) {
				sourceLag = { behind: Math.max(0, tip - indexed), tip };
			}
		}
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const dropdownItems = siblings.map((s) => ({
		name: s.name,
		href: `/subgraphs/${name}/subscriptions/${s.id}`,
	}));

	const needsDiagnosis =
		sub.status === "paused" || sub.status === "error" || deadRows.length > 0;

	// Delivery-attempt stats stay client-side (the log polls them), so the
	// server-rendered prompt carries only what this request already resolved.
	const observed: ObservedSubscriptionState = {
		status: sub.status,
		url: sub.url,
		format: sub.format,
		runtime: sub.runtime,
		capturedAt: new Date().toISOString(),
		circuitOpenedAt: sub.circuitOpenedAt,
		circuitFailures: sub.circuitFailures,
		lastError: sub.lastError,
		lastSuccessAt: sub.lastSuccessAt,
		timeoutMs: sub.timeoutMs,
		deadCount: deadRows.length,
		deadOldestBlock:
			deadRows.length > 0
				? Math.min(...deadRows.map((r) => r.blockHeight))
				: null,
		sourceTable: `${sub.subgraphName}.${sub.tableName}`,
		sourceBlocksBehind: sourceLag?.behind ?? null,
	};

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link
							href="/platform/subgraphs"
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subgraphs
						</Link>
						{" / "}
						<Link
							href={`/subgraphs/${name}`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							{name}
						</Link>
						{" / "}
						<Link
							href={`/subgraphs/${name}/subscriptions`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subscriptions
						</Link>
					</>
				}
				page={
					<BreadcrumbDropdown
						current={sub.name}
						items={dropdownItems}
						allHref={`/subgraphs/${name}/subscriptions`}
						allLabel="View all subscriptions"
					/>
				}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<MetaGrid
						items={[
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(sub.status)}`}>
										{sub.status}
									</span>
								),
								tooltip: "Current delivery state of this subscription",
							},
							{
								label: "Source",
								value: `${sub.subgraphName}.${sub.tableName}`,
								mono: true,
								tooltip: "Subgraph table this subscription observes",
							},
							{
								label: "Format",
								value: sub.format,
								mono: true,
								tooltip: "Payload format sent to the receiver",
							},
							{
								label: "Runtime",
								value: sub.runtime ?? "—",
								mono: true,
								tooltip: "Receiver runtime adapter",
							},
							{
								label: "URL",
								value: sub.url,
								mono: true,
								copyValue: sub.url,
								tooltip: "Delivery endpoint",
								span: 2,
							},
							{
								label: "Last delivery",
								value: sub.lastDeliveryAt
									? new Date(sub.lastDeliveryAt).toLocaleString()
									: "—",
								tooltip: "Most recent delivery attempt timestamp",
							},
							{
								label: "Last success",
								value: sub.lastSuccessAt
									? new Date(sub.lastSuccessAt).toLocaleString()
									: "—",
								tooltip: "Most recent 2xx response from the receiver",
							},
							{
								label: "Circuit failures",
								value: sub.circuitFailures.toString(),
								tooltip:
									"Consecutive delivery failures. Circuit opens after threshold and pauses delivery.",
							},
							{
								label: "Last error",
								value: sub.lastError ?? "—",
								tooltip: "Most recent delivery error message",
								span: 2,
							},
						]}
					/>

					{/* Evidence first: what happened, then why, then what you can do
					    about it, then settings, then the irreversible thing. */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Delivery log</span>
						</div>
						<p className="detail-desc" style={{ marginBottom: 12 }}>
							Last 100 attempts, refreshing every 5s.
						</p>
						<DeliveryLog subscriptionId={sub.id} />
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">
								Dead letter queue
								{deadRows.length > 0 && (
									<span className="cnt">{deadRows.length}</span>
								)}
							</span>
						</div>
						<p className="detail-desc" style={{ marginBottom: 12 }}>
							Outbox rows that exhausted all retries. Requeue after fixing the
							receiver.
						</p>
						<Dlq subscriptionId={sub.id} />
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">
								Diagnostics
								{sub.circuitOpenedAt && (
									<span className="cnt">circuit open</span>
								)}
							</span>
						</div>
						<Diagnostics
							subscriptionId={sub.id}
							circuitFailures={sub.circuitFailures}
							circuitOpenedAt={sub.circuitOpenedAt}
							lastSuccessAt={sub.lastSuccessAt}
							timeoutMs={sub.timeoutMs}
							deadCount={deadRows.length}
							sourceLag={sourceLag}
						/>

						<div className="sg-set-label" style={{ margin: "16px 0 8px" }}>
							Hand it to your agent
						</div>
						{needsDiagnosis && (
							<PromptCard
								name="Diagnose delivery failure"
								description="Inspects detail, deliveries, dead-letter rows, and the linked subgraph. Carries the state above so the agent starts from evidence."
								prompt={getAgentPrompt("subscription-diagnose", {
									subscriptionId: sub.id,
									subscriptionName: sub.name,
									observed,
								})}
							/>
						)}
						{deadRows.length > 0 && (
							<PromptCard
								name="Requeue dead letters"
								description={`Inspects the ${deadRows.length} dead ${
									deadRows.length === 1 ? "row" : "rows"
								} and proposes requeueing one at a time, only after you confirm each outbox id.`}
								prompt={`${getAgentPrompt("subscription-diagnose", {
									subscriptionId: sub.id,
									subscriptionName: sub.name,
									observed,
								})}

There are ${deadRows.length} dead-letter rows. Inspect them and propose requeueing one selected row only after I confirm the outbox id.`}
							/>
						)}
						<PromptCard
							name="Generate signed test fixture"
							description="Produces a Standard Webhooks body, headers, and curl against your receiver. Uses a secret you paste in chat — never the stored one."
							prompt={getAgentPrompt("subscription-test", {
								subscriptionId: sub.id,
								subscriptionName: sub.name,
								observed,
							})}
						/>
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Replay</span>
						</div>
						<div className="sg-set-block">
							<div className="sg-set-label">Replay block range</div>
							<div className="sg-set-desc">
								Re-emit rows from{" "}
								<span className="mono">
									{sub.subgraphName}.{sub.tableName}
								</span>{" "}
								in a block range. Replays drain at 10% of batch capacity so live
								deliveries aren't starved. Receivers must be idempotent — dedup
								on the <span className="mono">webhook-id</span> header.
							</div>
							<ReplayDialog subscriptionId={sub.id} />
						</div>
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Settings</span>
						</div>
						<SubscriptionSettings id={sub.id} status={sub.status} />
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Danger zone</span>
						</div>
						<SubscriptionDangerZone id={sub.id} subgraphName={name} />
					</section>
				</div>
			</div>
		</>
	);
}
