/** Shared display formatting — one definition instead of a copy per screen. */

/** `uptime_s` → `11d 4h` / `4h 12m` / `12m`. */
export function humanUptime(seconds: number): string {
	const d = Math.floor(seconds / 86_400);
	const h = Math.floor((seconds % 86_400) / 3_600);
	const m = Math.floor((seconds % 3_600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

/** `db_size_bytes` → `412 GB` (1024-based, one decimal under 10). */
export function humanBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const display =
		value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
	return `${display} ${units[unit]}`;
}

/** Big-stat count → `41.2M` / `618.4K`; smaller counts keep separators. */
export function compactCount(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 100_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

export function timeAgo(iso?: string | null): string | null {
	if (!iso) return null;
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return null;
	const s = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}
