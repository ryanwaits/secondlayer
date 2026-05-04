import type { StreamsTip } from "@secondlayer/sdk/streams";
import {
	formatLag,
	formatLastChecked,
	indexFreshnessColor,
	indexFreshnessLabel,
	truncateHash,
	type ApiHealth,
} from "@/lib/status-page";
import type { IndexFreshnessStatus } from "@/lib/types";

export type StatusSnapshot = {
	health: ApiHealth;
	tip: StreamsTip | null;
	index: IndexFreshnessStatus | null;
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
				<div className="status-block-kicker">Incident note</div>
				<p className="status-incident">{incidentHeading}</p>
			</div>
		</section>
	);
}
