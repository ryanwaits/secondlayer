import type { SystemStatus } from "@/lib/types";

const STATUS_API_URL =
	process.env.SL_API_URL || "https://api.secondlayer.tools";
const STATUS_API_KEY =
	process.env.SL_STATUS_API_KEY || process.env.SL_SERVICE_KEY;
const STATUS_PATH = STATUS_API_KEY ? "/status" : "/public/status";

// Server-side status snapshot shared by the homepage badge and the footer
// status item. Next's data cache dedupes the fetch across both call sites.
export async function readStatusSnapshot(): Promise<SystemStatus | null> {
	try {
		const headers: Record<string, string> = {};
		if (STATUS_API_KEY) headers.Authorization = `Bearer ${STATUS_API_KEY}`;
		const res = await fetch(`${STATUS_API_URL}${STATUS_PATH}`, {
			headers,
			// ISR: keep pages static + prefetchable; refresh the snapshot
			// server-side at most every 30s instead of a blocking fetch per request.
			next: { revalidate: 30 },
		});
		if (!res.ok) return null;
		return (await res.json()) as SystemStatus;
	} catch {
		return null;
	}
}

export type StatusState = "green" | "yellow" | "red" | "muted";

// Reflects only the API health check. Per-surface freshness (stream lag,
// decoder catch-up) is intentionally excluded — it made the badge flip to
// "Index catching up" during normal backfill. Green while the service is up.
//
// Severity is graded, not binary: the API self-reports "degraded" when it's up
// but slow/partial — that's `yellow` (warn), NOT `red`. `red` is reserved for a
// confirmed hard-down signal; an unreachable status endpoint is `muted`
// ("unknown"), since our own probe failing isn't proof the service is down.
export function healthState(status: SystemStatus | null): StatusState {
	if (!status) return "muted";
	if (status.status === "healthy") return "green";
	if (status.status === "degraded") return "yellow";
	return "red";
}

export function summaryLabel(state: StatusState): string {
	switch (state) {
		case "yellow":
			return "Service degraded";
		case "red":
			return "Service down";
		case "muted":
			return "Status unavailable";
		default:
			return "All systems operational";
	}
}
