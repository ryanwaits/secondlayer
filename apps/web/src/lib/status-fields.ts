/** `index.events_total` from a /public/status body, or null. Client-safe. */
export function readEventsTotal(body: unknown): number | null {
	const v = (body as { index?: { events_total?: unknown } } | null)?.index
		?.events_total;
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}
