import { randomBytes } from "node:crypto";
import { logger } from "@secondlayer/shared";
import { getConfig, imageName } from "./config.ts";
import {
	type ContainerSpec,
	containerCreate,
	containerStart,
	networkConnectWithAlias,
	networkEnsure,
	pullImage,
	volumeEnsure,
	waitForHealthy,
} from "./docker.ts";
import { generateTenantSecret, mintTenantKeys } from "./jwt.ts";
import { runMigrations } from "./migrations.ts";
import {
	NETWORK_SOURCE,
	NETWORK_TENANTS,
	allContainerNames,
	apiContainerName,
	generateSlug,
	pgContainerName,
	processorContainerName,
	volumeName,
} from "./names.ts";
import { type PlanId, getPlan } from "./plans.ts";
import { buildSourceReadonlyUrl } from "./readonly-role.ts";
import { teardownTenant } from "./teardown.ts";
import {
	type ProvisionError,
	type TenantResources,
	classifyProvisionError,
} from "./types.ts";

export interface ProvisionOptions {
	accountId: string;
	plan: PlanId;
	/**
	 * Optional explicit slug (for tests + migration). Production callers
	 * should omit — provisioner generates a random one.
	 */
	slug?: string;
}

/**
 * Full tenant-provision sequence. Best-effort cleanup on any failure.
 * Returns the full `TenantResources` on success; throws a `ProvisionError`
 * annotated with the failing stage on error.
 */
export async function provisionTenant(
	opts: ProvisionOptions,
): Promise<TenantResources> {
	const cfg = getConfig();
	const plan = getPlan(opts.plan);
	const slug = opts.slug ?? generateSlug();
	const dbPassword = randomBytes(24).toString("base64url");
	const jwtSecret = generateTenantSecret();

	logger.info("Provisioning tenant", {
		slug,
		plan: plan.id,
		accountId: opts.accountId,
	});

	try {
		// 1. Networks — idempotent.
		await stage("network", slug, async () => {
			await networkEnsure(NETWORK_TENANTS);
			await networkEnsure(NETWORK_SOURCE);
			// Shared platform postgres needs to be reachable as `postgres:5432`
			// from tenant containers on sl-source. Compose does this in
			// docker-compose.hetzner.yml, but this connect is idempotent
			// belt-and-suspenders for fresh hosts where compose hasn't yet
			// declared the alias.
			await networkConnectWithAlias(
				NETWORK_SOURCE,
				"secondlayer-postgres-1",
				"postgres",
			).catch((err) => {
				logger.warn(
					"Could not attach secondlayer-postgres-1 to sl-source — tenant may fail to reach source DB",
					{ error: err instanceof Error ? err.message : String(err) },
				);
			});
		});

		// 2. Pull images (idempotent; skipped if cached).
		await stage("api", slug, async () => {
			await pullImage(imageName(cfg, "api"));
		});

		// 3. Volume for tenant PG.
		const vol = volumeName(slug);
		await stage("volume", slug, async () => {
			await volumeEnsure(vol);
		});

		// 4. Postgres container — tenant DB.
		const pgName = pgContainerName(slug);
		const pgHost = `${pgName}:5432`;
		const targetDatabaseUrl = `postgres://secondlayer:${encodeURIComponent(
			dbPassword,
		)}@${pgHost}/secondlayer`;

		let pgId: string;
		await stage("postgres", slug, async () => {
			pgId = await containerCreate(
				buildPostgresSpec(pgName, dbPassword, plan, slug),
			);
			await containerStart(pgId);
			await waitForHealthy(pgName, 60_000);
		});

		// 5. Run migrations on the fresh DB.
		await stage("migrate", slug, async () => {
			await runMigrations(cfg, slug, targetDatabaseUrl, [NETWORK_TENANTS]);
		});

		// 6. API container.
		const apiName = apiContainerName(slug);
		const sourceDatabaseUrl = buildSourceReadonlyUrl();
		let apiId: string;
		await stage("api", slug, async () => {
			apiId = await containerCreate(
				buildApiSpec({
					name: apiName,
					image: imageName(cfg, "api"),
					slug,
					plan: plan.id,
					alloc: plan.containers.api,
					targetDatabaseUrl,
					sourceDatabaseUrl,
					jwtSecret,
					stacksNodeRpcUrl: cfg.stacksNodeRpcUrl,
					hiroApiUrl: cfg.hiroApiUrl,
					hiroApiKey: cfg.hiroApiKey,
					secretsKey: cfg.secretsKey,
				}),
			);
			await containerStart(apiId);
			await waitForHealthy(apiName, 30_000);
		});

		// 7. Subgraph processor.
		const procName = processorContainerName(slug);
		let procId: string;
		await stage("processor", slug, async () => {
			procId = await containerCreate(
				buildProcessorSpec({
					name: procName,
					image: imageName(cfg, "api"),
					slug,
					plan: plan.id,
					alloc: plan.containers.processor,
					targetDatabaseUrl,
					sourceDatabaseUrl,
					stacksNodeRpcUrl: cfg.stacksNodeRpcUrl,
					hiroApiUrl: cfg.hiroApiUrl,
					hiroApiKey: cfg.hiroApiKey,
					secretsKey: cfg.secretsKey,
				}),
			);
			await containerStart(procId);
			// Processor has no health endpoint — fall through once running.
			await waitForHealthy(procName, 20_000);
		});

		const { anonKey, serviceKey } = await mintTenantKeys(slug, jwtSecret, {
			serviceGen: 1,
			anonGen: 1,
		});

		return {
			slug,
			plan: plan.id,
			apiUrlInternal: `http://${apiName}:3800`,
			apiUrlPublic: `https://${slug}.${cfg.tenantBaseDomain}`,
			targetDatabaseUrl,
			tenantJwtSecret: jwtSecret,
			anonKey,
			serviceKey,
			// biome-ignore lint/style/noNonNullAssertion: set above in their stage closures
			containerIds: { postgres: pgId!, api: apiId!, processor: procId! },
			volumeName: vol,
			createdAt: new Date().toISOString(),
		};
	} catch (err) {
		logger.error("Tenant provision failed, tearing down", {
			slug,
			error: err instanceof Error ? err.message : String(err),
		});
		await teardownTenant(slug, { deleteVolume: true }).catch(() => {});
		throw annotateProvisionError(err, slug);
	}
}

// --- Stage helpers ---

async function stage<T>(
	name: ProvisionError["stage"],
	slug: string,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const wrapped = new Error(
			`Provision stage "${name}" failed for ${slug}: ${msg}`,
		) as ProvisionError;
		wrapped.stage = name;
		wrapped.slug = slug;
		wrapped.cleanupAttempted = false;
		wrapped.code = classifyProvisionError(name, msg);
		throw wrapped;
	}
}

function annotateProvisionError(err: unknown, slug: string): ProvisionError {
	if (err instanceof Error && "stage" in err) {
		(err as ProvisionError).cleanupAttempted = true;
		// `code` is set by `stage()`; keep it if already present.
		if (!(err as ProvisionError).code) {
			(err as ProvisionError).code = classifyProvisionError(
				(err as ProvisionError).stage,
				err.message,
			);
		}
		return err as ProvisionError;
	}
	const msg = err instanceof Error ? err.message : String(err);
	const wrapped = new Error(msg) as ProvisionError;
	wrapped.stage = "api";
	wrapped.slug = slug;
	wrapped.cleanupAttempted = true;
	wrapped.code = classifyProvisionError("api", msg);
	return wrapped;
}

// --- Container spec builders ---

function buildPostgresSpec(
	name: string,
	password: string,
	plan: ReturnType<typeof getPlan>,
	slug: string,
): ContainerSpec {
	return {
		name,
		image: "postgres:17-alpine",
		env: {
			POSTGRES_USER: "secondlayer",
			POSTGRES_PASSWORD: password,
			POSTGRES_DB: "secondlayer",
		},
		mounts: [
			{
				type: "volume",
				source: volumeName(slug),
				target: "/var/lib/postgresql/data",
			},
		],
		networks: [NETWORK_TENANTS],
		labels: {
			"secondlayer.role": "postgres",
			"secondlayer.slug": slug,
			"secondlayer.plan": plan.id,
		},
		memoryMb: plan.containers.postgres.memoryMb,
		cpus: plan.containers.postgres.cpus,
		healthCheck: {
			cmd: ["pg_isready", "-U", "secondlayer"],
			interval: "10s",
			timeout: "5s",
			retries: 5,
			startPeriod: "10s",
		},
	};
}

interface ApiSpecInput {
	name: string;
	image: string;
	slug: string;
	plan: PlanId;
	alloc: { memoryMb: number; cpus: number };
	targetDatabaseUrl: string;
	sourceDatabaseUrl: string;
	jwtSecret: string;
	stacksNodeRpcUrl?: string | null;
	serviceGen?: number;
	anonGen?: number;
	hiroApiUrl?: string | null;
	hiroApiKey?: string | null;
	secretsKey: string;
}

export function buildApiSpec(input: ApiSpecInput): ContainerSpec {
	return {
		name: input.name,
		image: input.image,
		env: {
			INSTANCE_MODE: "dedicated",
			DATABASE_URL: input.targetDatabaseUrl,
			SOURCE_DATABASE_URL: input.sourceDatabaseUrl,
			TARGET_DATABASE_URL: input.targetDatabaseUrl,
			TENANT_JWT_SECRET: input.jwtSecret,
			TENANT_SLUG: input.slug,
			TENANT_PLAN: input.plan,
			SERVICE_GEN: String(input.serviceGen ?? 1),
			ANON_GEN: String(input.anonGen ?? 1),
			SECONDLAYER_SECRETS_KEY: input.secretsKey,
			...(input.stacksNodeRpcUrl
				? { STACKS_NODE_RPC_URL: input.stacksNodeRpcUrl }
				: {}),
			...(input.hiroApiUrl ? { HIRO_API_URL: input.hiroApiUrl } : {}),
			...(input.hiroApiKey ? { HIRO_API_KEY: input.hiroApiKey } : {}),
			PORT: "3800",
			NODE_ENV: "production",
			LOG_LEVEL: "info",
		},
		exposedPorts: ["3800/tcp"],
		networks: [NETWORK_TENANTS, NETWORK_SOURCE],
		labels: {
			"secondlayer.role": "api",
			"secondlayer.slug": input.slug,
			"secondlayer.plan": input.plan,
		},
		memoryMb: input.alloc.memoryMb,
		cpus: input.alloc.cpus,
		healthCheck: {
			cmd: ["curl", "-sf", "http://localhost:3800/health"],
			interval: "10s",
			timeout: "3s",
			retries: 3,
			startPeriod: "10s",
		},
	};
}

interface ProcessorSpecInput {
	name: string;
	image: string;
	slug: string;
	plan: PlanId;
	alloc: { memoryMb: number; cpus: number };
	targetDatabaseUrl: string;
	sourceDatabaseUrl: string;
	stacksNodeRpcUrl?: string | null;
	hiroApiUrl?: string | null;
	hiroApiKey?: string | null;
	secretsKey: string;
}

export function buildProcessorSpec(input: ProcessorSpecInput): ContainerSpec {
	return {
		name: input.name,
		image: input.image,
		cmd: ["bun", "run", "packages/subgraphs/src/service.ts"],
		env: {
			INSTANCE_MODE: "dedicated",
			DATABASE_URL: input.targetDatabaseUrl,
			SOURCE_DATABASE_URL: input.sourceDatabaseUrl,
			TARGET_DATABASE_URL: input.targetDatabaseUrl,
			SECONDLAYER_SECRETS_KEY: input.secretsKey,
			...(input.stacksNodeRpcUrl
				? { STACKS_NODE_RPC_URL: input.stacksNodeRpcUrl }
				: {}),
			...(input.hiroApiUrl ? { HIRO_API_URL: input.hiroApiUrl } : {}),
			...(input.hiroApiKey ? { HIRO_API_KEY: input.hiroApiKey } : {}),
			TENANT_PLAN: input.plan,
			NODE_ENV: "production",
			LOG_LEVEL: "info",
		},
		networks: [NETWORK_TENANTS, NETWORK_SOURCE],
		labels: {
			"secondlayer.role": "processor",
			"secondlayer.slug": input.slug,
			"secondlayer.plan": input.plan,
		},
		memoryMb: input.alloc.memoryMb,
		cpus: input.alloc.cpus,
		// Reusing the `api` image — the processor doesn't serve /health, so
		// disable the inherited image healthcheck.
		disableHealthCheck: true,
	};
}

export function tenantContainerNames(slug: string): string[] {
	return allContainerNames(slug);
}
