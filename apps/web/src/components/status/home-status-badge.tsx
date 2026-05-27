import { indexFreshnessColor } from "@/lib/status-page";
import type { FreshnessColor } from "@/lib/status-page";
import type { IndexDecoderFreshness, SystemStatus } from "@/lib/types";
import Link from "next/link";

type StatusState = FreshnessColor | "red";

function streamState(status: SystemStatus | null): StatusState {
	const lag = status?.streams?.tip?.lag_seconds;
	if (status?.streams?.status === "unavailable" || lag == null) return "muted";
	return lag >= 60 ? "yellow" : "green";
}

function apiState(status: SystemStatus | null): StatusState {
	if (!status) return "muted";
	return status.status === "healthy" ? "green" : "yellow";
}

function decoderFor(
	status: SystemStatus | null,
	eventType: IndexDecoderFreshness["eventType"],
) {
	return status?.index?.decoders.find(
		(decoder) => decoder.eventType === eventType,
	);
}

// Worst-of every public surface — one summary instead of per-service rows.
function overallState(status: SystemStatus | null): StatusState {
	const states: StatusState[] = [
		apiState(status),
		streamState(status),
		indexFreshnessColor(decoderFor(status, "ft_transfer")),
		indexFreshnessColor(decoderFor(status, "nft_transfer")),
		status?.chainTip == null ? "muted" : "green",
	];
	if (states.includes("red")) return "red";
	if (states.includes("yellow")) return "yellow";
	if (states.includes("muted")) return "muted";
	return "green";
}

function summaryLabel(state: StatusState): string {
	switch (state) {
		case "red":
			return "Service degraded";
		case "yellow":
			return "Index catching up";
		case "muted":
			return "Status unavailable";
		default:
			return "All systems operational";
	}
}

export function HomeStatusBadge({ status }: { status: SystemStatus | null }) {
	const state = overallState(status);

	return (
		<div className="home-status-shell">
			<Link href="/status" className="home-status-pill" data-state={state}>
				<span className="home-status-dot" aria-hidden="true" />
				{summaryLabel(state)}
			</Link>
		</div>
	);
}
