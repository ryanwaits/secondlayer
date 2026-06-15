import type { StreamsTip } from "@secondlayer/sdk/streams";
import type {
	ApiTelemetryStatus,
	IndexDecoderFreshness,
	IndexFreshnessStatus,
	ServiceHealth,
	ServiceHealthStatus,
	SystemStatus,
} from "./types";

export type StatusState = "checking" | "ok" | "degraded" | "down";
export type FreshnessColor = "green" | "yellow" | "muted";

/** Lag (seconds) at which a surface/decoder is considered degraded. Normal
 *  ingest lag sits ~45s, so this is set well above that to avoid flapping the
 *  public status to "degraded" on routine block-spacing variance. */
export const LAG_DEGRADED_SECONDS = 180;

export type ApiHealth = {
	state: StatusState;
	label: string;
	description: string;
};

/** The live status snapshot the page polls each 30s. */
export type StatusSnapshot = {
	health: ApiHealth;
	tip: StreamsTip | null;
	index: IndexFreshnessStatus | null;
	api: ApiTelemetryStatus | null;
	node: { status: "ok" | "degraded" | "unavailable" } | null;
	services: ServiceHealth[];
	lastChecked: Date | null;
	error: string | null;
};

export type TipProbe =
	| { ok: true; tip: Pick<StreamsTip, "lag_seconds"> }
	| { ok: false; status?: number; error?: unknown };

export function determineApiHealth(probe: TipProbe): ApiHealth {
	if (!probe.ok) {
		return {
			state: "down",
			label: "Down",
			description: "The tip request failed.",
		};
	}

	if (probe.tip.lag_seconds >= LAG_DEGRADED_SECONDS) {
		return {
			state: "degraded",
			label: "Degraded",
			description: "The API is reachable. The indexer is behind.",
		};
	}

	return {
		state: "ok",
		label: "OK",
		description: `The API is reachable and ingest lag is under ${LAG_DEGRADED_SECONDS}s.`,
	};
}

/** Map a raw SystemStatus into the page snapshot. Shared by the server
 *  (initial paint, no loading flash) and the client poll. */
export function snapshotFromSystemStatus(
	status: SystemStatus,
	checkedAt: Date,
): StatusSnapshot {
	return {
		health: determinePublicStatusHealth(status),
		tip: status.streams?.tip ?? null,
		index: status.index ?? null,
		api: status.api ?? null,
		node: status.node ?? null,
		services: status.services ?? [],
		lastChecked: checkedAt,
		error: null,
	};
}

export function determinePublicStatusHealth(
	status: SystemStatus | null,
): ApiHealth {
	if (!status) return determineApiHealth({ ok: false });
	if (status.status === "degraded") {
		return {
			state: "degraded",
			label: "Degraded",
			description: "One or more public health checks are degraded.",
		};
	}
	return {
		state: "ok",
		label: "OK",
		description: "Public API health checks are passing.",
	};
}

export function formatLag(seconds: number | null | undefined): string {
	if (seconds == null || !Number.isFinite(seconds)) return "Unknown";
	if (seconds < 0) return "0s";
	if (seconds < 60) return `${Math.round(seconds)}s`;

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.round(seconds % 60);
	if (minutes < 60) {
		return remainingSeconds === 0
			? `${minutes}m`
			: `${minutes}m ${remainingSeconds}s`;
	}

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes === 0
		? `${hours}h`
		: `${hours}h ${remainingMinutes}m`;
}

export function indexFreshnessColor(
	decoder:
		| Pick<IndexDecoderFreshness, "lagSeconds" | "status">
		| null
		| undefined,
): FreshnessColor {
	if (!decoder || decoder.status === "unavailable") return "muted";
	if (decoder.lagSeconds == null || !Number.isFinite(decoder.lagSeconds)) {
		return "muted";
	}
	return decoder.lagSeconds >= LAG_DEGRADED_SECONDS ? "yellow" : "green";
}

const DECODER_SHORT_NAME: Record<string, string> = {
	ft_transfer: "FT",
	nft_transfer: "NFT",
	pox4_call: "PoX-4",
	bns_print: "BNS",
	sbtc: "sBTC",
};

export function decoderShortName(eventType: string): string {
	return DECODER_SHORT_NAME[eventType] ?? eventType;
}

export function decoderRowLabel(eventType: string): string {
	return `${decoderShortName(eventType)} decoder`;
}

export function indexFreshnessLabel(
	eventType: IndexDecoderFreshness["eventType"],
	status: IndexFreshnessStatus | null | undefined,
): string {
	const decoder = status?.decoders.find((item) => item.eventType === eventType);
	const prefix = decoderShortName(eventType);
	if (!decoder || decoder.status === "unavailable")
		return `${prefix} unavailable`;
	return `${prefix} ${formatLag(decoder.lagSeconds)}`;
}

export function formatLastChecked(date: Date | null): string {
	if (!date) return "Not checked yet";
	return date
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d{3}Z$/, " UTC");
}

export function truncateHash(hash: string | null | undefined): string {
	if (!hash) return "Unknown";
	if (hash.length <= 18) return hash;
	return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function formatLatencyMs(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return "Unknown";
	return `${Math.max(0, Math.round(value))}ms`;
}

export function formatErrorRate(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return "Unknown";
	return `${(Math.max(0, value) * 100).toFixed(2)}%`;
}

export function serviceStatusColor(
	status: ServiceHealthStatus,
): FreshnessColor {
	if (status === "ok") return "green";
	if (status === "degraded") return "yellow";
	return "muted";
}

export function serviceDisplayName(name: string): string {
	switch (name) {
		case "api":
			return "API";
		case "database":
			return "Database";
		case "indexer":
			return "Indexer service";
		case "l2_decoder":
			return "Decoder";
		default:
			return name.replace(/_/g, " ");
	}
}

export function apiTelemetryOrEmpty(
	api: ApiTelemetryStatus | null | undefined,
): Pick<ApiTelemetryStatus, "latency" | "error_rate" | "requests"> {
	return (
		api ?? {
			latency: { p50_ms: null, p95_ms: null },
			error_rate: 0,
			requests: 0,
		}
	);
}

// ── High-level surface status (for the minimal status page) ──────────
// Each surface maps to a REAL signal in the snapshot. Where no signal is
// available, the surface is "unknown" (muted) — never fabricated as "ok".

export type SurfaceState = "ok" | "degraded" | "down" | "unknown";
export type Surface = { key: string; label: string; state: SurfaceState };

const STATE_RANK: Record<SurfaceState, number> = {
	unknown: 0,
	ok: 1,
	degraded: 2,
	down: 3,
};

function healthToState(state: StatusState): SurfaceState {
	if (state === "ok") return "ok";
	if (state === "degraded") return "degraded";
	if (state === "down") return "down";
	return "unknown";
}

function serviceState(services: ServiceHealth[], match: RegExp): SurfaceState {
	const svc = services.find((s) => match.test(s.name));
	if (!svc) return "unknown";
	if (svc.status === "ok") return "ok";
	if (svc.status === "degraded") return "degraded";
	return "unknown"; // "unavailable" = we can't observe it, not a confirmed down
}

function indexOverallState(index: IndexFreshnessStatus | null): SurfaceState {
	const decoders = index?.decoders ?? [];
	if (!decoders.length) return "unknown";
	const colors = decoders.map((d) => indexFreshnessColor(d));
	if (colors.every((c) => c === "muted")) return "unknown";
	if (colors.some((c) => c === "yellow")) return "degraded";
	return "ok";
}

function streamsState(tip: StreamsTip | null): SurfaceState {
	const lag = tip?.lag_seconds;
	if (lag == null || !Number.isFinite(lag)) return "unknown";
	return lag >= LAG_DEGRADED_SECONDS ? "degraded" : "ok";
}

function nodeState(
	node: { status: "ok" | "degraded" | "unavailable" } | null,
): SurfaceState {
	if (node?.status === "ok") return "ok";
	if (node?.status === "degraded") return "degraded";
	return "unknown";
}

/** The six high-level product surfaces, each from a real snapshot signal. */
export function deriveSurfaces(snapshot: StatusSnapshot): Surface[] {
	return [
		{ key: "index", label: "Index", state: indexOverallState(snapshot.index) },
		{
			key: "subgraphs",
			label: "Subgraphs",
			state: serviceState(snapshot.services, /subgraph/i),
		},
		{ key: "streams", label: "Streams", state: streamsState(snapshot.tip) },
		{
			key: "webhooks",
			label: "Webhooks",
			state: serviceState(snapshot.services, /subscription|webhook/i),
		},
		{ key: "api", label: "API", state: healthToState(snapshot.health.state) },
		{ key: "node", label: "Stacks node", state: nodeState(snapshot.node) },
	];
}

export type OverallStatus = {
	state: SurfaceState;
	pill: string;
	headline: string;
	sub: string;
};

/** Headline verdict = the worst of the API health + every known surface. */
export function overallStatus(
	snapshot: StatusSnapshot,
	surfaces: Surface[],
): OverallStatus {
	if (snapshot.health.state === "checking") {
		return {
			state: "unknown",
			pill: "Checking",
			headline: "Checking status…",
			sub: "Fetching the latest health snapshot.",
		};
	}

	let worst = healthToState(snapshot.health.state);
	for (const s of surfaces) {
		if (STATE_RANK[s.state] > STATE_RANK[worst]) worst = s.state;
	}

	if (worst === "down") {
		return {
			state: "down",
			pill: "Down",
			headline: "Service disruption.",
			sub: snapshot.health.description,
		};
	}
	if (worst === "degraded") {
		return {
			state: "degraded",
			pill: "Degraded",
			headline: "Some systems degraded.",
			sub: snapshot.health.description,
		};
	}
	return {
		state: "ok",
		pill: "Operational",
		headline: "All systems operational.",
		sub: "Decoded Stacks data, indexing, and delivery — running normally.",
	};
}

/** Compact "30s ago" / "just now" relative time for the last-checked line. */
export function formatRelative(date: Date | null): string {
	if (!date) return "—";
	const seconds = Math.round((Date.now() - date.getTime()) / 1000);
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	return `${Math.floor(minutes / 60)}h ago`;
}

export function readIncidentHeading(markdown: string): string {
	const heading = markdown
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.startsWith("## "));

	return heading ? heading.replace(/^##\s+/, "") : "No active incidents";
}
