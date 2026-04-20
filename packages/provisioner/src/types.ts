import type { PlanId } from "./plans.ts";

export interface TenantResources {
	slug: string;
	plan: PlanId;
	/** Internal URL for tenant API (resolvable inside `sl-tenants` docker net). */
	apiUrlInternal: string;
	/** Public URL served by Caddy wildcard + on-demand TLS. */
	apiUrlPublic: string;
	/** Connection string for tenant PG with the tenant's own DB user. */
	targetDatabaseUrl: string;
	/** Encrypted JWT secret — shared with control plane for anon/service token minting. */
	tenantJwtSecret: string;
	/** Anon JWT (read-only, long-lived). */
	anonKey: string;
	/** Service JWT (full access, long-lived). */
	serviceKey: string;
	containerIds: {
		postgres: string;
		api: string;
		processor: string;
	};
	volumeName: string;
	createdAt: string;
}

export interface ContainerStatus {
	name: string;
	id: string;
	state: "running" | "exited" | "restarting" | "paused" | "unknown";
	/** CPU usage as fraction of allocated CPUs (0-1). */
	cpuUsage?: number;
	/** Memory usage in bytes. */
	memoryUsageBytes?: number;
	/** Memory limit in bytes. */
	memoryLimitBytes?: number;
}

export interface TenantStatus {
	slug: string;
	plan: PlanId;
	containers: ContainerStatus[];
	storageUsedMb?: number;
	storageLimitMb: number;
}

export interface ProvisionRequest {
	accountId: string;
	plan: PlanId;
}

export interface ResizeRequest {
	newPlan: PlanId;
}

export type ProvisionErrorCode =
	/** GHCR (or other registry) denied the image pull — likely wrong owner/tag or private repo w/o creds. */
	| "image_denied"
	/** Registry returned 404 / manifest not found. */
	| "image_not_found"
	/** Docker network issue (creating/connecting networks). */
	| "network_error"
	/** Container healthcheck never turned healthy within the wait window. */
	| "health_failed"
	/** Anything else — unclassified failure bubble-up. */
	| "internal";

export interface ProvisionError extends Error {
	stage:
		| "slug"
		| "readonly"
		| "network"
		| "volume"
		| "postgres"
		| "migrate"
		| "api"
		| "processor";
	slug: string;
	cleanupAttempted: boolean;
	code: ProvisionErrorCode;
}

export function isProvisionError(e: unknown): e is ProvisionError {
	return (
		e instanceof Error && "stage" in e && "slug" in e && "cleanupAttempted" in e
	);
}

/**
 * Map a stage + underlying Docker/runtime error message to a
 * {@link ProvisionErrorCode}. Kept here so both the error-thrower (provision.ts)
 * and the route-layer classifier agree on the taxonomy.
 */
export function classifyProvisionError(
	stage: ProvisionError["stage"],
	message: string,
): ProvisionErrorCode {
	const lower = message.toLowerCase();
	if (
		lower.includes("error from registry") ||
		lower.includes("denied") ||
		lower.includes("unauthorized")
	) {
		return "image_denied";
	}
	if (lower.includes("manifest unknown") || lower.includes("not found")) {
		if (stage === "api" || stage === "processor") return "image_not_found";
	}
	if (lower.includes("became unhealthy") || lower.includes("timed out")) {
		return "health_failed";
	}
	if (stage === "network") return "network_error";
	return "internal";
}

/** HTTP status code to use when surfacing a {@link ProvisionError}. */
export function httpStatusForProvisionError(
	code: ProvisionErrorCode,
): 400 | 404 | 502 | 503 | 500 {
	switch (code) {
		case "image_denied":
		case "image_not_found":
			return 502; // dependency (registry) failed
		case "network_error":
			return 503; // infra-level, likely transient
		case "health_failed":
			return 502; // dependency (container) didn't come up
		default:
			return 500;
	}
}

export type { Plan, PlanId } from "./plans.ts";
