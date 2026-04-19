import { logger } from "@secondlayer/shared";
import { getConfig, imageName } from "./config.ts";
import {
	type ContainerSpec,
	containerCreate,
	containerInspect,
	containerStart,
	containerStats,
	containerStop,
} from "./docker.ts";
import {
	NETWORK_SOURCE,
	NETWORK_TENANTS,
	allContainerNames,
	apiContainerName,
	pgContainerName,
	processorContainerName,
	volumeName,
} from "./names.ts";
import { type PlanId, getPlan } from "./plans.ts";
import type { ContainerStatus, TenantStatus } from "./types.ts";

/** Stop all tenant containers. Preserves the data volume. */
export async function suspendTenant(slug: string): Promise<void> {
	logger.info("Suspending tenant", { slug });
	// Stop API + processor first so no writes hit PG during shutdown.
	for (const name of [
		apiContainerName(slug),
		processorContainerName(slug),
		pgContainerName(slug),
	]) {
		await containerStop(name, 15).catch((err) => {
			logger.warn("Failed to stop container during suspend", {
				slug,
				container: name,
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}
}

/** Start all tenant containers in dependency order. */
export async function resumeTenant(slug: string): Promise<void> {
	logger.info("Resuming tenant", { slug });
	// PG first so API + processor can reach it on startup.
	for (const name of allContainerNames(slug)) {
		await containerStart(name).catch((err) => {
			logger.warn("Failed to start container during resume", {
				slug,
				container: name,
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}
}

/**
 * Resize tenant containers to a new plan's resource limits.
 * Data volume preserved; JWT secret + DB password recovered by inspecting
 * the existing API container's env. Brief downtime (typically <30s).
 */
export async function resizeTenant(
	slug: string,
	newPlan: PlanId,
): Promise<void> {
	const cfg = getConfig();
	const plan = getPlan(newPlan);
	logger.info("Resizing tenant", { slug, plan: plan.id });

	// Recover existing creds from the API container env. If it's missing,
	// the tenant wasn't properly provisioned — fail clearly.
	const apiName = apiContainerName(slug);
	const current = await containerInspect(apiName);
	if (!current) {
		throw new Error(
			`Tenant ${slug} has no API container — cannot recover credentials to resize`,
		);
	}
	const env = await extractEnv(apiName);
	const jwtSecret = env.TENANT_JWT_SECRET;
	const targetDatabaseUrl = env.TARGET_DATABASE_URL;
	const sourceDatabaseUrl = env.SOURCE_DATABASE_URL;
	if (!jwtSecret || !targetDatabaseUrl || !sourceDatabaseUrl) {
		throw new Error(
			`Tenant ${slug} API container missing required env — cannot resize`,
		);
	}

	// Parse db password out of the target URL for PG container rebuild.
	const pgPassword = parsePasswordFromUrl(targetDatabaseUrl);
	if (!pgPassword) {
		throw new Error(`Cannot parse password from tenant ${slug} DATABASE_URL`);
	}

	// Tear down containers (keep volume).
	await suspendTenant(slug);
	for (const name of allContainerNames(slug)) {
		const { containerRemove } = await import("./docker.ts");
		await containerRemove(name).catch(() => {});
	}

	// Rebuild with new sizes.
	const pgId = await containerCreate(
		buildPgSpec({
			name: pgContainerName(slug),
			slug,
			password: pgPassword,
			plan: plan.id,
			memoryMb: plan.containers.postgres.memoryMb,
			cpus: plan.containers.postgres.cpus,
		}),
	);
	await containerStart(pgId);

	const { waitForHealthy } = await import("./docker.ts");
	await waitForHealthy(pgContainerName(slug), 60_000);

	const apiId = await containerCreate(
		buildApiSpec({
			name: apiName,
			image: imageName(cfg, "api"),
			slug,
			plan: plan.id,
			memoryMb: plan.containers.api.memoryMb,
			cpus: plan.containers.api.cpus,
			env,
		}),
	);
	await containerStart(apiId);
	await waitForHealthy(apiName, 30_000);

	const procId = await containerCreate(
		buildProcessorSpec({
			name: processorContainerName(slug),
			image: imageName(cfg, "api"),
			slug,
			memoryMb: plan.containers.processor.memoryMb,
			cpus: plan.containers.processor.cpus,
			env,
		}),
	);
	await containerStart(procId);

	logger.info("Tenant resized", { slug, plan: plan.id });
}

/**
 * Current status + live stats for a tenant. Reads docker — no control-plane DB.
 */
export async function getTenantStatus(
	slug: string,
	plan: PlanId,
): Promise<TenantStatus> {
	const planDef = getPlan(plan);
	const containers: ContainerStatus[] = [];
	for (const name of allContainerNames(slug)) {
		const info = await containerInspect(name);
		if (!info) {
			containers.push({ name, id: "", state: "unknown" });
			continue;
		}
		const stats = info.State.Running
			? await containerStats(name).catch(() => null)
			: null;
		containers.push({
			name,
			id: info.Id,
			state: normalizeState(info.State.Status),
			cpuUsage: stats?.cpuUsage,
			memoryUsageBytes: stats?.memoryUsageBytes,
			memoryLimitBytes: stats?.memoryLimitBytes,
		});
	}
	return {
		slug,
		plan,
		containers,
		storageLimitMb: planDef.storageLimitMb,
	};
}

// --- Internals ---

function normalizeState(raw: string): ContainerStatus["state"] {
	switch (raw) {
		case "running":
		case "restarting":
		case "paused":
		case "exited":
			return raw;
		default:
			return "unknown";
	}
}

async function extractEnv(nameOrId: string): Promise<Record<string, string>> {
	// Inspect returns a narrowed type that omits Config.Env — fetch raw via the
	// same socket path and parse. Avoid widening public types for this
	// one-off need.
	const cfg = getConfig();
	// biome-ignore lint/suspicious/noExplicitAny: Bun-specific unix-socket fetch option
	const init = { unix: cfg.dockerSocketPath } as any;
	const res = await fetch(`http://docker/containers/${nameOrId}/json`, init);
	if (!res.ok) {
		throw new Error(
			`Failed to inspect ${nameOrId} for env recovery: ${res.status}`,
		);
	}
	const body = (await res.json()) as { Config?: { Env?: string[] } };
	const env: Record<string, string> = {};
	for (const entry of body.Config?.Env ?? []) {
		const idx = entry.indexOf("=");
		if (idx === -1) continue;
		env[entry.slice(0, idx)] = entry.slice(idx + 1);
	}
	return env;
}

function parsePasswordFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		return decodeURIComponent(parsed.password);
	} catch {
		return null;
	}
}

// --- Spec builders for resize (simplified copies of provision.ts versions) ---

function buildPgSpec(input: {
	name: string;
	slug: string;
	password: string;
	plan: PlanId;
	memoryMb: number;
	cpus: number;
}): ContainerSpec {
	return {
		name: input.name,
		image: "postgres:17-alpine",
		env: {
			POSTGRES_USER: "secondlayer",
			POSTGRES_PASSWORD: input.password,
			POSTGRES_DB: "secondlayer",
		},
		mounts: [
			{
				type: "volume",
				source: volumeName(input.slug),
				target: "/var/lib/postgresql/data",
			},
		],
		networks: [NETWORK_TENANTS],
		labels: {
			"secondlayer.role": "postgres",
			"secondlayer.slug": input.slug,
			"secondlayer.plan": input.plan,
		},
		memoryMb: input.memoryMb,
		cpus: input.cpus,
		healthCheck: {
			cmd: ["pg_isready", "-U", "secondlayer"],
			interval: "10s",
			timeout: "5s",
			retries: 5,
			startPeriod: "10s",
		},
	};
}

function buildApiSpec(input: {
	name: string;
	image: string;
	slug: string;
	plan: PlanId;
	memoryMb: number;
	cpus: number;
	env: Record<string, string>;
}): ContainerSpec {
	return {
		name: input.name,
		image: input.image,
		env: input.env,
		exposedPorts: ["3800/tcp"],
		networks: [NETWORK_TENANTS, NETWORK_SOURCE],
		labels: {
			"secondlayer.role": "api",
			"secondlayer.slug": input.slug,
			"secondlayer.plan": input.plan,
		},
		memoryMb: input.memoryMb,
		cpus: input.cpus,
		healthCheck: {
			cmd: ["curl", "-sf", "http://localhost:3800/health"],
			interval: "10s",
			timeout: "3s",
			retries: 3,
			startPeriod: "10s",
		},
	};
}

function buildProcessorSpec(input: {
	name: string;
	image: string;
	slug: string;
	memoryMb: number;
	cpus: number;
	env: Record<string, string>;
}): ContainerSpec {
	return {
		name: input.name,
		image: input.image,
		cmd: ["bun", "run", "packages/subgraphs/src/service.ts"],
		env: input.env,
		networks: [NETWORK_TENANTS, NETWORK_SOURCE],
		labels: {
			"secondlayer.role": "processor",
			"secondlayer.slug": input.slug,
		},
		memoryMb: input.memoryMb,
		cpus: input.cpus,
	};
}
