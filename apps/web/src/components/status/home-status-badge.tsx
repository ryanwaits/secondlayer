import type { SystemStatus } from "@/lib/types";
import Link from "next/link";

type StatusState = "green" | "red" | "muted";

// Reflects only the API health check. Per-surface freshness (stream lag,
// decoder catch-up) is intentionally excluded — it made the badge flip to
// "Index catching up" during normal backfill. Green while the service is up.
function healthState(status: SystemStatus | null): StatusState {
	if (!status) return "muted";
	return status.status === "healthy" ? "green" : "red";
}

function summaryLabel(state: StatusState): string {
	switch (state) {
		case "red":
			return "Service degraded";
		case "muted":
			return "Status unavailable";
		default:
			return "All systems operational";
	}
}

export function HomeStatusBadge({ status }: { status: SystemStatus | null }) {
	const state = healthState(status);

	return (
		<div className="home-status-shell">
			<Link href="/status" className="home-status-pill" data-state={state}>
				<span className="home-status-dot" aria-hidden="true" />
				{summaryLabel(state)}
			</Link>
		</div>
	);
}
