import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest } from "@/lib/api";
import type {
	DeadRow,
	SubgraphDetail,
	SubscriptionDetail,
	SubscriptionSummary,
} from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubscriptionDangerZone, SubscriptionSettings } from "./actions";
import { DeliveryLog } from "./delivery-log";
import { Diagnostics } from "./diagnostics";
import { Dlq } from "./dlq";
import { ReplayDialog } from "./replay-dialog";

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

	let siblings: SubscriptionSummary[] = [];
	let deadRows: DeadRow[] = [];
	// A delivery problem and an indexing problem look identical from the
	// delivery log alone, so diagnostics needs to know whether the source is
	// keeping up. Best-effort: a failed fetch just hides that one chip.
	let sourceLag: { behind: number; tip: number } | null = null;

	const [detailResult, listResult, deadResult, subgraphResult] =
		await Promise.allSettled([
			apiRequest<SubscriptionDetail>(
				`/api/subscriptions/${encodeURIComponent(id)}`,
			),
			apiRequest<{ data: SubscriptionSummary[] }>("/api/subscriptions"),
			apiRequest<{ data: DeadRow[] }>(
				`/api/subscriptions/${encodeURIComponent(id)}/dead`,
			),
			apiRequest<SubgraphDetail>(`/api/subgraphs/${encodeURIComponent(name)}`),
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
	const sub: SubscriptionDetail = detailResult.value;
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

	const dropdownItems = siblings.map((s) => ({
		name: s.name,
		href: `/subgraphs/${name}/subscriptions/${s.id}`,
	}));

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
