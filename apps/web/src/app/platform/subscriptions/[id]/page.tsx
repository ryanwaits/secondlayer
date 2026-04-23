import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import { notFound } from "next/navigation";
import { SubscriptionActions } from "./actions";
import { DeliveryLog } from "./delivery-log";
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

export default async function SubscriptionDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let sub: SubscriptionDetail;
	try {
		sub = await fetchFromTenantOrThrow<SubscriptionDetail>(
			session,
			`/api/subscriptions/${id}`,
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	return (
		<>
			<OverviewTopbar page={`Subscription · ${sub.name}`} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="detail-section">
						<h2>{sub.name}</h2>
						<dl className="meta-grid">
							<div>
								<dt>Status</dt>
								<dd>
									<span
										className={`status-badge ${sub.status === "active" ? "active" : sub.status === "paused" ? "syncing" : "error"}`}
									>
										{sub.status}
									</span>
								</dd>
							</div>
							<div>
								<dt>Source</dt>
								<dd>
									<code>
										{sub.subgraphName}.{sub.tableName}
									</code>
								</dd>
							</div>
							<div>
								<dt>Format</dt>
								<dd>
									<code>{sub.format}</code>
								</dd>
							</div>
							<div>
								<dt>Runtime</dt>
								<dd>{sub.runtime ?? "—"}</dd>
							</div>
							<div>
								<dt>URL</dt>
								<dd>
									<code style={{ wordBreak: "break-all" }}>{sub.url}</code>
								</dd>
							</div>
							<div>
								<dt>Last delivery</dt>
								<dd>
									{sub.lastDeliveryAt
										? new Date(sub.lastDeliveryAt).toLocaleString()
										: "—"}
								</dd>
							</div>
							<div>
								<dt>Last success</dt>
								<dd>
									{sub.lastSuccessAt
										? new Date(sub.lastSuccessAt).toLocaleString()
										: "—"}
								</dd>
							</div>
							<div>
								<dt>Last error</dt>
								<dd>{sub.lastError ?? "—"}</dd>
							</div>
						</dl>
					</div>

					<SubscriptionActions id={sub.id} status={sub.status} />

					<div className="detail-section">
						<h2>Replay</h2>
						<ReplayDialog subscriptionId={sub.id} />
					</div>

					<div className="detail-section">
						<h2>Delivery log</h2>
						<p className="detail-desc">
							Last 100 attempts, refreshing every 5s.
						</p>
						<DeliveryLog subscriptionId={sub.id} />
					</div>

					<div className="detail-section">
						<h2>Dead letter queue</h2>
						<p className="detail-desc">
							Outbox rows that exhausted all retries. Requeue after fixing the
							receiver.
						</p>
						<Dlq subscriptionId={sub.id} />
					</div>
				</div>
			</div>
		</>
	);
}
