import type { StreamsTip } from "@secondlayer/sdk/streams";
import {
	apiTelemetryOrEmpty,
	formatErrorRate,
	formatLag,
	formatLastChecked,
	formatLatencyMs,
	indexFreshnessColor,
	indexFreshnessLabel,
	serviceDisplayName,
	serviceStatusColor,
	truncateHash,
	type ApiHealth,
} from "@/lib/status-page";
import type {
	ApiTelemetryStatus,
	IndexFreshnessStatus,
	ServiceHealth,
} from "@/lib/types";

export type StatusSnapshot = {
	health: ApiHealth;
	tip: StreamsTip | null;
	index: IndexFreshnessStatus | null;
	api: ApiTelemetryStatus | null;
	node: { status: "ok" | "degraded" | "unavailable" } | null;
	services: ServiceHealth[];
	reorgs: { last_24h: number | null } | null;
	lastChecked: Date | null;
	error: string | null;
};

export function StatusGridView({
	snapshot,
	incidentHeading,
}: {
	snapshot: StatusSnapshot;
	incidentHeading: string;
}) {
	const api = apiTelemetryOrEmpty(snapshot.api);
	const nodeStatus = snapshot.node?.status ?? "unavailable";

	return (
		<section className="status-grid" aria-label="Second Layer service status">
			<div className={`status-block status-block-${snapshot.health.state}`}>
				<div className="status-block-kicker">API health</div>
				<div className="status-block-row">
					<div className="status-state">
						<span className="status-state-dot" aria-hidden="true" />
						<span>{snapshot.health.label}</span>
					</div>
					<div className="status-last-checked">
						Checked {formatLastChecked(snapshot.lastChecked)}
					</div>
				</div>
				<p className="status-block-copy">{snapshot.health.description}</p>
				{snapshot.error ? (
					<p className="status-error">Error: {snapshot.error}</p>
				) : null}
			</div>

			<div className="status-block">
				<div className="status-block-kicker">Current chain tip</div>
				<dl className="status-metrics">
					<div>
						<dt>Block height</dt>
						<dd>{snapshot.tip?.block_height.toLocaleString() ?? "Unknown"}</dd>
					</div>
					<div>
						<dt>Lag</dt>
						<dd>{formatLag(snapshot.tip?.lag_seconds)}</dd>
					</div>
					<div>
						<dt>Index block hash</dt>
						<dd className="status-hash">
							{truncateHash(snapshot.tip?.index_block_hash)}
						</dd>
					</div>
				</dl>
			</div>

			<div className="status-block">
				<div className="status-block-kicker">API telemetry</div>
				<dl className="status-metrics">
					<div>
						<dt>p50 latency</dt>
						<dd>{formatLatencyMs(api.latency.p50_ms)}</dd>
					</div>
					<div>
						<dt>p95 latency</dt>
						<dd>{formatLatencyMs(api.latency.p95_ms)}</dd>
					</div>
					<div>
						<dt>5xx error rate</dt>
						<dd>{formatErrorRate(api.error_rate)}</dd>
					</div>
					<div>
						<dt>Requests sampled</dt>
						<dd>{api.requests.toLocaleString()}</dd>
					</div>
				</dl>
			</div>

			<div className="status-block">
				<div className="status-block-kicker">Stacks Index freshness</div>
				<dl className="status-metrics">
					{(["ft_transfer", "nft_transfer"] as const).map((eventType) => {
						const decoder =
							snapshot.index?.decoders.find(
								(item) => item.eventType === eventType,
							) ?? null;
						const color = indexFreshnessColor(decoder);

						return (
							<div key={eventType}>
								<dt>
									<span
										className={`status-freshness-dot status-freshness-${color}`}
										aria-hidden="true"
									/>
									{eventType === "ft_transfer" ? "FT decoder" : "NFT decoder"}
								</dt>
								<dd>{indexFreshnessLabel(eventType, snapshot.index)}</dd>
							</div>
						);
					})}
				</dl>
			</div>

			<div className="status-block">
				<div className="status-block-kicker">Node and services</div>
				<dl className="status-metrics">
					<div>
						<dt>
							<span
								className={`status-freshness-dot status-freshness-${serviceStatusColor(nodeStatus)}`}
								aria-hidden="true"
							/>
							Stacks node
						</dt>
						<dd>{nodeStatus}</dd>
					</div>
					{snapshot.services.map((service) => (
						<div key={service.name}>
							<dt>
								<span
									className={`status-freshness-dot status-freshness-${serviceStatusColor(service.status)}`}
									aria-hidden="true"
								/>
								{serviceDisplayName(service.name)}
							</dt>
							<dd>{service.status}</dd>
						</div>
					))}
					<div>
						<dt>Reorgs last 24h</dt>
						<dd>{snapshot.reorgs?.last_24h ?? "Unavailable"}</dd>
					</div>
				</dl>
			</div>

			<div className="status-block">
				<div className="status-block-kicker">Incident note</div>
				<p className="status-incident">{incidentHeading}</p>
			</div>
		</section>
	);
}
