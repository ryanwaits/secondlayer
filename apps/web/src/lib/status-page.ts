import type { StreamsTip } from "@secondlayer/sdk/streams";
import type {
	ApiTelemetryStatus,
	IndexDecoderFreshness,
	IndexFreshnessStatus,
	ServiceHealthStatus,
	SystemStatus,
} from "./types";

export type StatusState = "checking" | "ok" | "degraded" | "down";
export type FreshnessColor = "green" | "yellow" | "muted";

export type ApiHealth = {
	state: StatusState;
	label: string;
	description: string;
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

	if (probe.tip.lag_seconds >= 60) {
		return {
			state: "degraded",
			label: "Degraded",
			description: "The API is reachable. The indexer is behind.",
		};
	}

	return {
		state: "ok",
		label: "OK",
		description: "The API is reachable and ingest lag is under 60 seconds.",
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
	return decoder.lagSeconds >= 60 ? "yellow" : "green";
}

export function indexFreshnessLabel(
	eventType: IndexDecoderFreshness["eventType"],
	status: IndexFreshnessStatus | null | undefined,
): string {
	const decoder = status?.decoders.find((item) => item.eventType === eventType);
	const prefix = eventType === "ft_transfer" ? "FT" : "NFT";
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

export function serviceStatusColor(status: ServiceHealthStatus): FreshnessColor {
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
			return "L2 decoder";
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

export function readIncidentHeading(markdown: string): string {
	const heading = markdown
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.startsWith("## "));

	return heading ? heading.replace(/^##\s+/, "") : "No active incidents";
}
