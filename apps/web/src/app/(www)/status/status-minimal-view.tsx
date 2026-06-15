import {
	type StatusSnapshot,
	deriveSurfaces,
	formatErrorRate,
	formatLag,
	formatLatencyMs,
	formatRelative,
	overallStatus,
} from "@/lib/status-page";

/**
 * Minimal single-column status page: an overall verdict (pill + headline),
 * a four-metric strip, a row of per-surface pills, and one incident line.
 * Every value comes from the live snapshot — missing signals read "—" or a
 * muted "unknown" surface rather than a fabricated "operational".
 */
export function StatusMinimalView({
	snapshot,
	isRefreshing,
}: {
	snapshot: StatusSnapshot;
	/** Drives the bottom-right loading/live toolbar instead of flashing a
	 *  loading state into the headline. */
	isRefreshing?: boolean;
}) {
	const surfaces = deriveSurfaces(snapshot);
	const overall = overallStatus(snapshot, surfaces);
	const tip = snapshot.tip;

	// Incident line is derived from the LIVE verdict — not a stale markdown
	// heading. The footer links to INCIDENTS.md for the written history.
	const incidentLabel =
		overall.state === "ok"
			? "No active incidents"
			: overall.state === "unknown"
				? "Checking…"
				: "Investigating an active incident";

	const metrics = [
		{
			label: "Chain tip",
			value: tip ? `#${tip.block_height.toLocaleString("en-US")}` : "—",
		},
		{ label: "Lag", value: formatLag(tip?.lag_seconds) },
		{ label: "API p50", value: formatLatencyMs(snapshot.api?.latency.p50_ms) },
		{ label: "Errors", value: formatErrorRate(snapshot.api?.error_rate) },
	];

	return (
		<>
			<section className="status-min" aria-label="Service status">
				<span className={`status-min-pill status-min-${overall.state}`}>
					<span className="status-min-dot" aria-hidden="true" />
					{overall.pill}
				</span>

				<h1 className="status-min-head">{overall.headline}</h1>
				<p className="status-min-sub">{snapshot.error ?? overall.sub}</p>

				<div className="status-min-metrics">
					{metrics.map((m) => (
						<div className="status-min-metric" key={m.label}>
							<span className="status-min-metric-label">{m.label}</span>
							<span className="status-min-metric-value">{m.value}</span>
						</div>
					))}
				</div>

				<div className="status-min-surfaces">
					{surfaces.map((s) => (
						<span
							className={`status-min-surface status-min-${s.state}`}
							key={s.key}
						>
							<span className="status-min-dot" aria-hidden="true" />
							{s.label}
						</span>
					))}
				</div>

				<hr className="status-min-rule" />

				<p className={`status-min-foot status-min-${overall.state}`}>
					<span className="status-min-dot" aria-hidden="true" />
					{incidentLabel}
					{snapshot.lastChecked ? (
						<>
							{" · Last checked "}
							<span className="status-min-when">
								{formatRelative(snapshot.lastChecked)}
							</span>
						</>
					) : null}
				</p>
			</section>

			<div
				className={`status-min-live${isRefreshing ? " busy" : ""}`}
				aria-live="polite"
			>
				<span className="status-min-live-dot" aria-hidden="true" />
				{isRefreshing ? "Refreshing…" : "Live"}
			</div>
		</>
	);
}
