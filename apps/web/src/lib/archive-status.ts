/**
 * Server-side read of the public archive status object.
 *
 * archive.secondlayer.tools does not send CORS. A browser fetch from www
 * is blocked. This helper matches how protocol-marquee already reads the
 * platform API: Next server fetch, `{ next: { revalidate: 60 } }`, same
 * as the object's Cache-Control.
 *
 * The object itself only refreshes hourly (`secondlayer-archive-status.timer`),
 * so a client-side poll would not tick, and a pulsing "live" dot would
 * overstate freshness. Decoder head in this payload is the last hourly
 * observation, not a 10s Index tip.
 */
import type { ArchiveStatus } from "@secondlayer/sdk";

export const ARCHIVE_STATUS_URL =
	"https://archive.secondlayer.tools/status.json";

export async function fetchArchiveStatus(): Promise<ArchiveStatus | null> {
	try {
		const res = await fetch(ARCHIVE_STATUS_URL, {
			next: { revalidate: 60 },
		});
		if (!res.ok) return null;
		return (await res.json()) as ArchiveStatus;
	} catch {
		return null;
	}
}
