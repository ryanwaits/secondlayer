/**
 * HTTP client the platform API uses to call the provisioner service.
 *
 * Typed thin wrapper around `fetch`. The only auth is the shared
 * `PROVISIONER_SECRET` header — platform API + provisioner are both on
 * the internal docker network, so TLS isn't required.
 */

import { logger } from "@secondlayer/shared";

interface ProvisionerConfig {
	url: string;
	secret: string;
}

function getConfig(): ProvisionerConfig {
	const url = process.env.PROVISIONER_URL;
	const secret = process.env.PROVISIONER_SECRET;
	if (!url || !secret) {
		throw new Error(
			"PROVISIONER_URL and PROVISIONER_SECRET are required in platform mode",
		);
	}
	return { url: url.replace(/\/$/, ""), secret };
}

// Matches `TenantResources` from packages/provisioner/src/types.ts.
export interface ProvisionedTenant {
	slug: string;
	plan: "launch" | "grow" | "scale" | "enterprise";
	apiUrlInternal: string;
	apiUrlPublic: string;
	targetDatabaseUrl: string;
	tenantJwtSecret: string;
	anonKey: string;
	serviceKey: string;
	containerIds: {
		postgres: string;
		api: string;
		processor: string;
	};
	volumeName: string;
	createdAt: string;
}

export interface TenantStatusResponse {
	slug: string;
	plan: string;
	containers: Array<{
		name: string;
		id: string;
		state: "running" | "exited" | "restarting" | "paused" | "unknown";
		cpuUsage?: number;
		memoryUsageBytes?: number;
		memoryLimitBytes?: number;
	}>;
	storageUsedMb?: number;
	storageLimitMb: number;
}

async function request<T>(
	path: string,
	opts: {
		method?: "GET" | "POST" | "DELETE";
		body?: unknown;
	} = {},
): Promise<T> {
	const cfg = getConfig();
	const res = await fetch(`${cfg.url}${path}`, {
		method: opts.method ?? "GET",
		headers: {
			"x-provisioner-secret": cfg.secret,
			...(opts.body ? { "content-type": "application/json" } : {}),
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		logger.error("Provisioner call failed", {
			method: opts.method ?? "GET",
			path,
			status: res.status,
			body: body.slice(0, 500),
		});
		throw new ProvisionerError(res.status, opts.method ?? "GET", path, body);
	}
	return (await res.json()) as T;
}

export class ProvisionerError extends Error {
	override readonly name = "ProvisionerError";
	constructor(
		readonly status: number,
		readonly method: string,
		readonly path: string,
		readonly body: string,
	) {
		super(`Provisioner ${method} ${path} → ${status}: ${body.slice(0, 200)}`);
	}
}

export async function provisionTenant(input: {
	accountId: string;
	plan: "launch" | "grow" | "scale" | "enterprise";
}): Promise<ProvisionedTenant> {
	return request<ProvisionedTenant>("/tenants", {
		method: "POST",
		body: input,
	});
}

export async function getTenantStatus(
	slug: string,
	plan: string,
): Promise<TenantStatusResponse> {
	return request<TenantStatusResponse>(
		`/tenants/${slug}?plan=${encodeURIComponent(plan)}`,
	);
}

export async function suspendTenant(slug: string): Promise<void> {
	await request(`/tenants/${slug}/suspend`, { method: "POST" });
}

export async function resumeTenant(slug: string): Promise<void> {
	await request(`/tenants/${slug}/resume`, { method: "POST" });
}

export async function rotateTenantKeys(
	slug: string,
	input: {
		type: "service" | "anon" | "both";
		plan: string;
		newServiceGen: number;
		newAnonGen: number;
	},
): Promise<{ serviceKey?: string; anonKey?: string }> {
	return request<{ serviceKey?: string; anonKey?: string }>(
		`/tenants/${slug}/keys/rotate`,
		{ method: "POST", body: input },
	);
}

export async function resizeTenant(
	slug: string,
	newPlan: "launch" | "grow" | "scale" | "enterprise",
): Promise<void> {
	await request(`/tenants/${slug}/resize`, {
		method: "POST",
		body: { newPlan },
	});
}

export async function teardownTenant(
	slug: string,
	deleteVolume = false,
): Promise<void> {
	await request(
		`/tenants/${slug}?deleteVolume=${deleteVolume ? "true" : "false"}`,
		{ method: "DELETE" },
	);
}

export async function getTenantStorage(
	slug: string,
	targetDatabaseUrl: string,
): Promise<{ slug: string; sizeMb: number }> {
	return request<{ slug: string; sizeMb: number }>(
		`/tenants/${slug}/storage?url=${encodeURIComponent(targetDatabaseUrl)}`,
	);
}
