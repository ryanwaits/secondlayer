export function isExtendedViewEnabled(): boolean {
	return process.env.EXTENDED_VIEW === "1";
}

export function resolveExtendedPort(): number {
	const raw = process.env.EXTENDED_PORT ?? "3999";
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error(`EXTENDED_PORT must be a positive integer (got ${raw})`);
	}
	return n;
}
