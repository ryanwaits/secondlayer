import {
	type StatusSnapshot,
	snapshotFromSystemStatus,
} from "@/lib/status-page";
import type { SystemStatus } from "@/lib/types";
import { StatusClient } from "./status-client";

const STATUS_API_URL =
	process.env.NEXT_PUBLIC_STREAMS_API_URL ?? "https://api.secondlayer.tools";

/** Best-effort server probe so the first paint already carries a verdict —
 *  the header never flashes "Checking…". On failure the client poll fills in. */
async function fetchInitialSnapshot(): Promise<StatusSnapshot | null> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		const res = await fetch(`${STATUS_API_URL}/public/status`, {
			cache: "no-store",
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!res.ok) return null;
		const status = (await res.json()) as SystemStatus;
		return snapshotFromSystemStatus(status, new Date());
	} catch {
		return null;
	}
}

/** Wrapped in the marketing `.explore-wrap` container; the top nav and site
 *  footer come from the parent `(www)` layout. */
export async function StatusPageView() {
	const initialSnapshot = await fetchInitialSnapshot();
	return (
		<main className="explore-wrap status-page">
			<StatusClient initialSnapshot={initialSnapshot} />
		</main>
	);
}
