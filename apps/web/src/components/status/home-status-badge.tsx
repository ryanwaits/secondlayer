import { healthState, summaryLabel } from "@/lib/status-snapshot";
import type { SystemStatus } from "@/lib/types";
import Link from "next/link";

// Floating pill, desktop only — on mobile the same status renders as a
// footer item instead (SiteFooter), so the pill never eats phone space.
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
