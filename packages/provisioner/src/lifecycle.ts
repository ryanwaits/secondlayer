import { logger } from "@secondlayer/shared";
import { type ProvisionerConfig, getConfig, imageName } from "./config.ts";
import {
	type ContainerSpec,
	containerCreate,
	containerInspect,
	containerRemove,
	containerStart,
	containerStats,
	containerStop,
	waitForHealthy,
} from "./docker.ts";
import { mintSingleKey } from "./jwt.ts";
import { runMigrations } from "./migrations.ts";
import {
	NETWORK_SOURCE,
	NETWORK_TENANTS,
	allContainerNames,
	apiContainerName,
	pgContainerName,
	processorContainerName,
	volumeName,
} from "./names.ts";
import {
	type PlanId,
	allocForTotals,
	getPlan,
	isValidPlanId,
} from "./plans.ts";
import type { ContainerStatus, TenantStatus } from "./types.ts";

export type KeyRotateType = "service" | "anon" | "both";

export interface RotateResult {
	serviceKey?: string;
	anonKey?: string;
}

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
	const pgName = pgContainerName(slug);
	await containerStart(pgName).catch((err) => {
		logger.warn("Failed to start postgres during resume", {
			slug,
			container: pgName,
			error: err instanceof Error ? err.message : String(err),
		});
	});
	await waitForHealthy(pgName, 60_000);

	// Resume is also the operator-controlled path used after platform deploys.
	// Recreate the app containers so paused tenants pick up the current API image.
	await refreshTenantRuntime(slug);
}

/**
 * Recreate the tenant API + subgraph processor from the current API image.
 * Preserves tenant Postgres data and secrets recovered from the existing API
 * container. Intended for deploy upgrades and resume.
 */
export async function refreshTenantRuntime(slug: string): Promise<void> {
	const cfg = getConfig();
	const apiName = apiContainerName(slug);
	const procName = processorContainerName(slug);

	const currentApi = await containerInspect(apiName);
	if (!currentApi) {
		throw new Error(
			`Tenant ${slug} has no API container — cannot refresh runtime`,
		);
	}

	const env = withProvisionerRuntimeEnv(await extractEnv(apiName), cfg);
	const targetDatabaseUrl = env.TARGET_DATABASE_URL ?? env.DATABASE_URL;
	const sourceDatabaseUrl = env.SOURCE_DATABASE_URL;
	if (!targetDatabaseUrl || !sourceDatabaseUrl) {
		throw new Error(
			`Tenant ${slug} API container missing database env — cannot refresh runtime`,
		);
	}

	const plan = planFromLabels(currentApi.Config?.Labels);
	const planDefaults = getPlan(plan).containers;
	const currentProc = await containerInspect(procName);
	const apiAlloc = allocFromInspect(currentApi, planDefaults.api);
	const procAlloc = allocFromInspect(currentProc, planDefaults.processor);
	const image = imageName(cfg, "api");

	await containerStop(apiName, 15).catch(() => {});
	await containerStop(procName, 15).catch(() => {});
	await runMigrations(cfg, slug, targetDatabaseUrl, [NETWORK_TENANTS]);
	await containerRemove(apiName).catch(() => {});
	await containerRemove(procName).catch(() => {});

	const apiId = await containerCreate(
		buildApiSpec({
			name: apiName,
			image,
			slug,
			plan,
			memoryMb: apiAlloc.memoryMb,
			cpus: apiAlloc.cpus,
			env,
		}),
	);
	await containerStart(apiId);
	await waitForHealthy(apiName, 30_000);

	const procId = await containerCreate(
		buildProcessorSpec({
			name: procName,
			image,
			slug,
			plan,
			memoryMb: procAlloc.memoryMb,
			cpus: procAlloc.cpus,
			env,
		}),
	);
	await containerStart(procId);
	await waitForHealthy(procName, 20_000);

	logger.info("Tenant runtime refreshed", { slug, image });
}

export interface ResizeSpec {
	/** Plan id carried as a label (container `secondlayer.plan`) and for
	 * billing/display. Actual compute sizing comes from the explicit fields
	 * below, which represent `plan base + active add-ons`. */
	plan: PlanId;
	totalCpus: number;
	totalMemoryMb: number;
	storageLimitMb: number;
}

/**
 * Resize tenant containers to a new compute envelope.
 * Data volume preserved; JWT secret + DB password recovered by inspecting
 * the existing API container's env. Brief downtime (typically <30s).
 *
 * Compute is provided explicitly (decoupled from plan in Sprint C.1) so
 * the caller can fold in `tenant_compute_addons` before invoking.
 */
export async function resizeTenant(
	slug: string,
	spec: ResizeSpec,
): Promise<void> {
	const cfg = getConfig();
	logger.info("Resizing tenant", {
		slug,
		plan: spec.plan,
		totalCpus: spec.totalCpus,
		totalMemoryMb: spec.totalMemoryMb,
	});

	const containers = allocForTotals(spec.totalMemoryMb, spec.totalCpus);

	// Recover existing creds from the API container env. If it's missing,
	// the tenant wasn't properly provisioned — fail clearly.
	const apiName = apiContainerName(slug);
	const current = await containerInspect(apiName);
	if (!current) {
		throw new Error(
			`Tenant ${slug} has no API container — cannot recover credentials to resize`,
		);
	}
	const env = withProvisionerRuntimeEnv(await extractEnv(apiName), cfg);
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
		await containerRemove(name).catch(() => {});
	}

	// Rebuild with new sizes.
	const pgId = await containerCreate(
		buildPgSpec({
			name: pgContainerName(slug),
			slug,
			password: pgPassword,
			plan: spec.plan,
			memoryMb: containers.postgres.memoryMb,
			cpus: containers.postgres.cpus,
		}),
	);
	await containerStart(pgId);
	await waitForHealthy(pgContainerName(slug), 60_000);

	const apiId = await containerCreate(
		buildApiSpec({
			name: apiName,
			image: imageName(cfg, "api"),
			slug,
			plan: spec.plan,
			memoryMb: containers.api.memoryMb,
			cpus: containers.api.cpus,
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
			plan: spec.plan,
			memoryMb: containers.processor.memoryMb,
			cpus: containers.processor.cpus,
			env,
		}),
	);
	await containerStart(procId);

	logger.info("Tenant resized", { slug, plan: spec.plan });
}

/**
 * Rotate one or both tenant JWTs by bumping `SERVICE_GEN` / `ANON_GEN` on
 * the tenant API container + minting replacement keys with the new gen.
 *
 * Caller (platform API) owns the gen counters in the tenants table and
 * passes in the NEW values post-bump. The signing secret stays the same
 * — it's recovered from the existing container env so we never have to
 * transit it over HTTP. Only the API container is recreated; PG + processor
 * are untouched. ~5s tenant-API downtime per rotation.
 */
export async function rotateTenantKeys(
	slug: string,
	plan: PlanId,
	type: KeyRotateType,
	newGens: { serviceGen: number; anonGen: number },
): Promise<RotateResult> {
	const cfg = getConfig();
	logger.info("Rotating tenant keys", { slug, type });

	const apiName = apiContainerName(slug);
	const current = await containerInspect(apiName);
	if (!current) {
		throw new Error(`Tenant ${slug} has no API container — cannot rotate keys`);
	}
	const env = withProvisionerRuntimeEnv(await extractEnv(apiName), cfg);
	const jwtSecret = env.TENANT_JWT_SECRET;
	if (!jwtSecret) {
		throw new Error(
			`Tenant ${slug} API container missing TENANT_JWT_SECRET — corrupt state`,
		);
	}

	// Preserve the existing API container's compute — rotation only
	// touches the JWT env, not sizing. Reading from docker inspect avoids
	// recomputing from plan + add-ons and drifting if anything changed.
	const memoryLimitBytes = current.HostConfig?.Memory ?? 0;
	const nanoCpus = current.HostConfig?.NanoCpus ?? 0;
	const currentMemoryMb =
		memoryLimitBytes > 0 ? Math.round(memoryLimitBytes / (1024 * 1024)) : 256;
	const currentCpus = nanoCpus > 0 ? nanoCpus / 1_000_000_000 : 0.5;

	// Recreate API container with new gens. PG + processor keep running.
	await containerStop(apiName, 15).catch(() => {});
	await containerRemove(apiName).catch(() => {});

	const nextEnv: Record<string, string> = {
		...env,
		SERVICE_GEN: String(newGens.serviceGen),
		ANON_GEN: String(newGens.anonGen),
	};

	const apiId = await containerCreate(
		buildApiSpec({
			name: apiName,
			image: imageName(cfg, "api"),
			slug,
			plan,
			memoryMb: currentMemoryMb,
			cpus: currentCpus,
			env: nextEnv,
		}),
	);
	await containerStart(apiId);
	await waitForHealthy(apiName, 30_000);

	// Mint the replacement key(s). Only return what was rotated.
	const result: RotateResult = {};
	if (type === "service" || type === "both") {
		result.serviceKey = await mintSingleKey(
			slug,
			jwtSecret,
			"service",
			newGens.serviceGen,
		);
	}
	if (type === "anon" || type === "both") {
		result.anonKey = await mintSingleKey(
			slug,
			jwtSecret,
			"anon",
			newGens.anonGen,
		);
	}

	logger.info("Tenant keys rotated", { slug, type });
	return result;
}

/**
 * Current status + live stats for a tenant. Reads docker — no control-plane DB.
 *
 * `plan` + `storageLimitMb` are passed through from the caller's tenant
 * record so the response matches the tenant's effective spec (plan +
 * add-ons), not the plan's base spec.
 */
export async function getTenantStatus(
	slug: string,
	plan: PlanId,
	storageLimitMb: number,
): Promise<TenantStatus> {
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
		storageLimitMb,
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

export function withProvisionerRuntimeEnv(
	env: Record<string, string>,
	cfg: ProvisionerConfig,
): Record<string, string> {
	return {
		...env,
		STACKS_NODE_RPC_URL: cfg.stacksNodeRpcUrl,
		SECONDLAYER_SECRETS_KEY: cfg.secretsKey,
		...(cfg.hiroApiUrl ? { HIRO_API_URL: cfg.hiroApiUrl } : {}),
		...(cfg.hiroApiKey ? { HIRO_API_KEY: cfg.hiroApiKey } : {}),
	};
}

function parsePasswordFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		return decodeURIComponent(parsed.password);
	} catch {
		return null;
	}
}

function planFromLabels(labels: Record<string, string> | undefined): PlanId {
	const plan = labels?.["secondlayer.plan"];
	return plan && isValidPlanId(plan) ? plan : "launch";
}

function allocFromInspect(
	info: Awaited<ReturnType<typeof containerInspect>> | null,
	fallback: { memoryMb: number; cpus: number },
): { memoryMb: number; cpus: number } {
	const memoryLimitBytes = info?.HostConfig?.Memory ?? 0;
	const nanoCpus = info?.HostConfig?.NanoCpus ?? 0;
	return {
		memoryMb:
			memoryLimitBytes > 0
				? Math.round(memoryLimitBytes / (1024 * 1024))
				: fallback.memoryMb,
		cpus: nanoCpus > 0 ? nanoCpus / 1_000_000_000 : fallback.cpus,
	};
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
		env: { ...input.env, TENANT_PLAN: input.plan },
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
	plan: PlanId;
	memoryMb: number;
	cpus: number;
	env: Record<string, string>;
}): ContainerSpec {
	return {
		name: input.name,
		image: input.image,
		cmd: ["bun", "run", "packages/subgraphs/src/service.ts"],
		env: { ...input.env, TENANT_PLAN: input.plan },
		networks: [NETWORK_TENANTS, NETWORK_SOURCE],
		labels: {
			"secondlayer.role": "processor",
			"secondlayer.slug": input.slug,
			"secondlayer.plan": input.plan,
		},
		memoryMb: input.memoryMb,
		cpus: input.cpus,
		disableHealthCheck: true,
	};
}
