import { CODE_TO_STATUS } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod/v4";

export type ApiTelemetryGroup = "streams" | "index" | "platform" | "status";

export type ApiTelemetryStats = {
	latency: {
		p50_ms: number | null;
		p95_ms: number | null;
	};
	error_rate: number;
	requests: number;
	errors_5xx: number;
};

export type ApiTelemetrySnapshot = ApiTelemetryStats & {
	groups: Record<ApiTelemetryGroup, ApiTelemetryStats>;
	window_seconds: number;
};

type Sample = {
	at: number;
	durationMs: number;
	status: number;
};

const GROUPS: readonly ApiTelemetryGroup[] = [
	"streams",
	"index",
	"platform",
	"status",
];
const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES_PER_GROUP = 1000;

const samples = new Map<ApiTelemetryGroup, Sample[]>(
	GROUPS.map((group) => [group, []]),
);

export function classifyApiTelemetryPath(pathname: string): ApiTelemetryGroup {
	if (pathname === "/health" || pathname === "/status")
		return "status";
	if (pathname === "/public/status") return "status";
	if (pathname.startsWith("/v1/streams")) return "streams";
	if (pathname.startsWith("/v1/index")) return "index";
	return "platform";
}

function statusFromError(error: unknown): number {
	if (error instanceof ZodError) return 400;
	if (error instanceof HTTPException) return error.status;
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return (CODE_TO_STATUS as Record<string, number | undefined>)[error.code] ?? 500;
	}
	return 500;
}

function prune(groupSamples: Sample[], now: number): Sample[] {
	const fresh = groupSamples.filter((sample) => now - sample.at <= WINDOW_MS);
	if (fresh.length <= MAX_SAMPLES_PER_GROUP) return fresh;
	return fresh.slice(fresh.length - MAX_SAMPLES_PER_GROUP);
}

export function recordApiTelemetrySample(input: {
	group: ApiTelemetryGroup;
	durationMs: number;
	status: number;
	now?: number;
}): void {
	const now = input.now ?? Date.now();
	const groupSamples = prune(samples.get(input.group) ?? [], now);
	groupSamples.push({
		at: now,
		durationMs: Math.max(0, input.durationMs),
		status: input.status,
	});
	samples.set(input.group, prune(groupSamples, now));
}

function percentile(values: number[], percentileValue: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((percentileValue / 100) * sorted.length) - 1,
	);
	return Math.round(sorted[Math.max(0, index)]);
}

function statsFor(groupSamples: Sample[], now: number): ApiTelemetryStats {
	const fresh = prune(groupSamples, now);
	const durations = fresh.map((sample) => sample.durationMs);
	const errors5xx = fresh.filter((sample) => sample.status >= 500).length;
	return {
		latency: {
			p50_ms: percentile(durations, 50),
			p95_ms: percentile(durations, 95),
		},
		error_rate:
			fresh.length === 0 ? 0 : Number((errors5xx / fresh.length).toFixed(4)),
		requests: fresh.length,
		errors_5xx: errors5xx,
	};
}

export function getApiTelemetrySnapshot(now = Date.now()): ApiTelemetrySnapshot {
	const groups = Object.fromEntries(
		GROUPS.map((group) => {
			const fresh = prune(samples.get(group) ?? [], now);
			samples.set(group, fresh);
			return [group, statsFor(fresh, now)];
		}),
	) as Record<ApiTelemetryGroup, ApiTelemetryStats>;
	const allSamples = GROUPS.flatMap((group) => samples.get(group) ?? []);
	const aggregate = statsFor(allSamples, now);
	return {
		...aggregate,
		groups,
		window_seconds: WINDOW_MS / 1000,
	};
}

export function resetApiTelemetryForTests(): void {
	for (const group of GROUPS) samples.set(group, []);
}

export function apiTelemetry(): MiddlewareHandler {
	return async (c, next) => {
		const startedAt = performance.now();
		const group = classifyApiTelemetryPath(new URL(c.req.url).pathname);
		try {
			await next();
			recordApiTelemetrySample({
				group,
				durationMs: performance.now() - startedAt,
				status: c.res.status,
			});
		} catch (error) {
			recordApiTelemetrySample({
				group,
				durationMs: performance.now() - startedAt,
				status: statusFromError(error),
			});
			throw error;
		}
	};
}
