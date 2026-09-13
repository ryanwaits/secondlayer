import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { DeliveryRow, SubgraphDetail, WebhookDetail } from "@/lib/types";
import { notFound } from "next/navigation";
import { WebhookDangerZone, WebhookSettings } from "./actions";
import { DeliveryLog } from "./delivery-log";
import { Diagnostics } from "./diagnostics";
import { Dlq } from "./dlq";
import { ReplayDialog } from "./replay-dialog";

function statusBadge(status: string): { cls: string; label: string } {
	if (status === "active") return { cls: "active", label: "Live" };
	if (status === "paused") return { cls: "syncing", label: "Paused" };
	return { cls: "error", label: "Error" };
}

/** `https://ops.example.dev/hooks/sbtc` → `ops.example.dev/hooks/sbtc`. */
function trimUrl(url: string): string {
	return url.replace(/^[a-z]+:\/\//i, "");
}

export default async function WebhookDetailPage({
	params,
}: {
	params: Promise<{ name: string; id: string }>;
}) {
	const { name, id } = await params;

	// A delivery problem and an indexing problem look identical from the
	// delivery log alone, so diagnostics needs to know whether the source is
	// keeping up. Best-effort: a failed fetch just hides that one card.
	let sourceLag: { behind: number; tip: number } | null = null;
	let lastDelivery: DeliveryRow | null = null;

	const [detailResult, deliveriesResult, subgraphResult] =
		await Promise.allSettled([
			apiRequest<WebhookDetail>(`/api/webhooks/${encodeURIComponent(id)}`),
			apiRequest<{ data: DeliveryRow[] }>(
				`/api/webhooks/${encodeURIComponent(id)}/deliveries`,
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
	const sub: WebhookDetail = detailResult.value;
	if (sub.subgraphName !== name) notFound();
	if (deliveriesResult.status === "fulfilled") {
		lastDelivery = deliveriesResult.value.data[0] ?? null;
	}
	if (subgraphResult.status === "fulfilled") {
		const sg = subgraphResult.value;
		const tip = sg.sync?.chainTip ?? null;
		const indexed = sg.lastProcessedBlock ?? sg.sync?.lastProcessedBlock;
		if (tip != null && indexed != null) {
			sourceLag = { behind: Math.max(0, tip - indexed), tip };
		}
	}

	const badge = statusBadge(sub.status);
	const lastDeliveryDisplay = lastDelivery
		? `${timeAgo(lastDelivery.dispatchedAt)}${
				lastDelivery.statusCode != null ? ` · ${lastDelivery.statusCode}` : ""
			}`
		: "never";

	return (
		<>
			<OverviewTopbar
				crumbs={[
					{ label: "subgraphs", href: "/subgraphs" },
					{ label: name, href: `/subgraphs/${name}` },
					{
						label: "webhooks",
						href: `/subgraphs/${name}/webhooks`,
					},
					{ label: sub.name },
				]}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* 1 — identity: name, state, source */}
					<div className="ident">
						<h2>{sub.name}</h2>
						<span className={`badge ${badge.cls}`}>{badge.label}</span>
						<span className="kv">
							{sub.subgraphName} · {sub.tableName}
						</span>
					</div>

					{/* 2 — meta cards */}
					<div className="meta">
						<div className="meta-card">
							<div className="ov-label">Endpoint</div>
							<div className="meta-v mono" title={sub.url}>
								{trimUrl(sub.url)}
							</div>
						</div>
						<div className="meta-card">
							<div className="ov-label">Format</div>
							<div className="meta-v">{sub.format}</div>
						</div>
						<div className="meta-card">
							<div className="ov-label">Last delivery</div>
							<div className="meta-v mono">{lastDeliveryDisplay}</div>
						</div>
						<div className="meta-card">
							<div className="ov-label">Circuit failures</div>
							<div className="meta-v mono">
								{sub.circuitFailures} consecutive
							</div>
						</div>
					</div>

					{/* 3 — diagnostics, derived from the same attempts the log polls */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Diagnostics</span>
							<span className="r">derived from the last 100 attempts</span>
						</div>
						<Diagnostics
							webhookId={sub.id}
							subgraphName={sub.subgraphName}
							sourceLag={sourceLag}
						/>
					</section>

					{/* 4 — delivery log (owns its section head: live count) */}
					<DeliveryLog webhookId={sub.id} />

					{/* 5 — DLQ + replay, then pause/danger below */}
					<section className="sg-sec">
						<Dlq webhookId={sub.id} />
						<div className="panel">
							<h4>Replay</h4>
							<p>
								Re-dispatch deliveries for a block range. Rows are re-read from
								your Postgres — no archive fetch, no charge. Receivers must be
								idempotent: dedup on the{" "}
								<span className="mono">webhook-id</span> header.
							</p>
							<ReplayDialog webhookId={sub.id} />
						</div>
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Settings</span>
						</div>
						<WebhookSettings id={sub.id} status={sub.status} />
					</section>

					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Danger zone</span>
						</div>
						<WebhookDangerZone id={sub.id} subgraphName={name} />
					</section>
				</div>
			</div>
		</>
	);
}
