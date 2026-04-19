import type { PlanId } from "./plans.ts";

export interface TenantResources {
	slug: string;
	plan: PlanId;
	/** Internal URL for tenant API (resolvable inside `sl-tenants` docker net). */
	apiUrlInternal: string;
	/** Public URL once Traefik is live. */
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
}

export function isProvisionError(e: unknown): e is ProvisionError {
	return (
		e instanceof Error && "stage" in e && "slug" in e && "cleanupAttempted" in e
	);
}

export type { Plan, PlanId } from "./plans.ts";
