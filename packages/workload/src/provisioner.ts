/**
 * The provisioner: trusted, our code, the only thing on the workload host
 * that runs `docker compose` against a tenant's stack. One compose project
 * per account (`tenant-<acct8>`), own network, own Postgres container and
 * volume (D1). Idempotent at every transition (Design table): a retried
 * `up()` for a tenant that's already running is a no-op; a retried
 * `destroy()` for a tenant already gone is a no-op.
 *
 * Secrets are generated once, at first provision, and never regenerated —
 * they're written to a root-only directory on disk
 * (`<secretsRoot>/<acct8>/.env`), one per tenant, and handed to `docker
 * compose --env-file` so they never appear in `docker inspect` or shell
 * history. This module never logs a secret value.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@secondlayer/shared";
import { generateEd25519KeyPair } from "@secondlayer/shared/crypto/ed25519";
import type postgres from "postgres";
import {
	type TenantRow,
	acct8For,
	deleteTenant,
	getTenant,
	insertProvisioningTenant,
	listPollableTenants,
	setTenantState,
} from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";

export interface TenantSecrets {
	instanceToken: string;
	postgresPassword: string;
	secondlayerSecretsKey: string;
	streamsSigningPrivateKey: string;
	webhookSigningPrivateKey: string;
}

/** Fresh, per-tenant secrets. Never derived from a shared/prod value —
 *  Design: "A stack holds only that tenant's own secrets." */
export function generateTenantSecrets(): TenantSecrets {
	const streams = generateEd25519KeyPair();
	const webhook = generateEd25519KeyPair();
	return {
		instanceToken: randomBytes(32).toString("hex"),
		postgresPassword: randomBytes(24).toString("hex"),
		secondlayerSecretsKey: randomBytes(32).toString("hex"),
		streamsSigningPrivateKey: streams.privateKeyPem,
		webhookSigningPrivateKey: webhook.privateKeyPem,
	};
}

/**
 * The compose `--env-file` contents for one tenant. `accountReadKey` is a
 * DEDICATED `hosted-stack` key minted for this account (`mintTenantKey`,
 * `POST /internal/keys/tenant`) — never the customer's own presented key.
 * Design: "The customer's key never reaches the stack." A leak of this key
 * only leaks reads the account already owns, and those reads meter against
 * the same account (step 5, "Hosted reads by the stack" — already billed on
 * app-server).
 */
export function buildTenantEnv(opts: {
	secrets: TenantSecrets;
	accountReadKey: string;
	hostedApiUrl: string;
	tenantSocketDir: string;
	apiPort: number;
}): Record<string, string> {
	return {
		POSTGRES_PASSWORD: opts.secrets.postgresPassword,
		INSTANCE_TOKEN: opts.secrets.instanceToken,
		SECONDLAYER_SECRETS_KEY: opts.secrets.secondlayerSecretsKey,
		STREAMS_SIGNING_PRIVATE_KEY: opts.secrets.streamsSigningPrivateKey,
		SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY:
			opts.secrets.webhookSigningPrivateKey,
		HOSTED_API_URL: opts.hostedApiUrl,
		TENANT_HOSTED_READ_KEY: opts.accountReadKey,
		TENANT_SOCKET_DIR: opts.tenantSocketDir,
		// Loopback-only publish port for this tenant's `api` (review fix: the
		// gateway is a host process with no compose-network DNS, so it reaches
		// `api` over 127.0.0.1:<port>, never `tenant-<acct8>-api`).
		TENANT_API_PORT: String(opts.apiPort),
	};
}

/** `KEY=value` lines, one secret per line, no quoting surprises (values are
 *  hex/PEM/URL — none contain a bare newline except the PEM keys, which
 *  compose's env-file parser must receive as literal `\n`, matching how
 *  `docker/oss` operators already paste PEM keys into `.env`). */
export function renderEnvFile(env: Record<string, string>): string {
	return `${Object.entries(env)
		.map(([k, v]) => `${k}=${v.replace(/\r?\n/g, "\\n")}`)
		.join("\n")}\n`;
}

export interface ComposeResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type RunCompose = (
	args: string[],
	env: Record<string, string>,
) => Promise<ComposeResult>;

/** Real `docker compose` invocation. `env` is merged over `process.env` so
 *  compose's own var-substitution (`${WORKLOAD_IMAGE_OWNER:-ryanwaits}`,
 *  etc.) still resolves from the provisioner process's own environment. */
export const spawnCompose: RunCompose = async (args, env) => {
	const proc = Bun.spawn(["docker", "compose", ...args], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code: exitCode, stdout, stderr };
};

export type CheckCreditsOk = (
	accountIds: string[],
) => Promise<Record<string, boolean>>;

/** Real implementation: `POST /internal/accounts/credits`. Chunks at
 *  `batchSize` (matches the route's own cap) so a large tenant count never
 *  sends one oversized request. */
export function makeCheckCreditsOk(
	hostedApiUrl: string,
	workloadHostKey: string,
	fetchImpl: FetchLike = fetch,
	batchSize = 500,
): CheckCreditsOk {
	return async (accountIds: string[]): Promise<Record<string, boolean>> => {
		const out: Record<string, boolean> = {};
		for (let i = 0; i < accountIds.length; i += batchSize) {
			const chunk = accountIds.slice(i, i + batchSize);
			const res = await fetchImpl(
				`${hostedApiUrl.replace(/\/+$/, "")}/internal/accounts/credits`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${workloadHostKey}`,
					},
					body: JSON.stringify({ account_ids: chunk }),
				},
			);
			if (!res.ok) {
				throw new Error(`check credits failed: ${res.status}`);
			}
			Object.assign(out, (await res.json()) as Record<string, boolean>);
		}
		return out;
	};
}

export type MintTenantKey = (accountId: string) => Promise<string>;

/** Real implementation: `POST /internal/keys/tenant` on app-server (Design
 *  fix: mint a DEDICATED key for the tenant rather than forwarding the
 *  customer's own presented key into the stack). */
export function makeMintTenantKey(
	hostedApiUrl: string,
	workloadHostKey: string,
	fetchImpl: FetchLike = fetch,
): MintTenantKey {
	return async (accountId: string): Promise<string> => {
		const res = await fetchImpl(
			`${hostedApiUrl.replace(/\/+$/, "")}/internal/keys/tenant`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${workloadHostKey}`,
				},
				body: JSON.stringify({ account_id: accountId }),
			},
		);
		if (!res.ok) {
			throw new Error(`mint tenant key failed: ${res.status}`);
		}
		const body = (await res.json()) as { key?: string };
		if (!body.key) throw new Error("mint tenant key: no key in response");
		return body.key;
	};
}

export interface ProvisionerConfig {
	db: postgres.Sql;
	/** Root-only directory holding one subdirectory per tenant. */
	secretsRoot: string;
	composeFile: string;
	hostedApiUrl: string;
	/** Shared with app-server's `/internal/*` guards. Only needed for the
	 *  default `mintTenantKey`/`pollCredits` implementations — a test that
	 *  injects both can leave this unset. */
	workloadHostKey?: string;
	runCompose?: RunCompose;
	mintTenantKey?: MintTenantKey;
	checkCreditsOk?: CheckCreditsOk;
	fetchImpl?: FetchLike;
}

function resolveMintTenantKey(cfg: ProvisionerConfig): MintTenantKey {
	if (cfg.mintTenantKey) return cfg.mintTenantKey;
	if (!cfg.workloadHostKey) {
		throw new Error(
			"ProvisionerConfig needs workloadHostKey (or an injected mintTenantKey) to mint a tenant key",
		);
	}
	return makeMintTenantKey(
		cfg.hostedApiUrl,
		cfg.workloadHostKey,
		cfg.fetchImpl,
	);
}

function resolveCheckCreditsOk(cfg: ProvisionerConfig): CheckCreditsOk {
	if (cfg.checkCreditsOk) return cfg.checkCreditsOk;
	if (!cfg.workloadHostKey) {
		throw new Error(
			"ProvisionerConfig needs workloadHostKey (or an injected checkCreditsOk) to poll credits",
		);
	}
	return makeCheckCreditsOk(
		cfg.hostedApiUrl,
		cfg.workloadHostKey,
		cfg.fetchImpl,
	);
}

function tenantDir(cfg: ProvisionerConfig, acct8: string): string {
	return join(cfg.secretsRoot, acct8);
}

function projectName(acct8: string): string {
	return `tenant-${acct8}`;
}

function writeSecretsToDisk(
	dir: string,
	socketDir: string,
	envFile: string,
): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	mkdirSync(socketDir, { recursive: true, mode: 0o700 });
	const path = join(dir, ".env");
	writeFileSync(path, envFile, { mode: 0o600 });
	chmodSync(path, 0o600);
}

/**
 * `none → provisioning → running` (Design). Idempotent: a tenant already
 * `running` returns immediately; a tenant mid-`provisioning` (a concurrent
 * request raced this one) is left alone rather than double-provisioned —
 * the control DB's PK is the single point of truth for "who provisions."
 *
 * Never takes the customer's presented key — it mints a dedicated
 * `hosted-stack` key for the account itself (`resolveMintTenantKey`,
 * `POST /internal/keys/tenant`), so the customer's own key never reaches a
 * tenant stack (Design fix).
 *
 * On failure past the point secrets are written (compose up errors), this
 * tears down whatever compose managed to start and deletes the control-db
 * row (review fix 5) — a stuck `provisioning` row would 503 every request
 * for that account forever; deleting it lets the NEXT request retry
 * `up()` from scratch instead.
 */
export async function up(
	cfg: ProvisionerConfig,
	accountId: string,
): Promise<TenantRow["state"]> {
	const runCompose = cfg.runCompose ?? spawnCompose;
	const acct8 = acct8For(accountId);
	const existing = await getTenant(cfg.db, accountId);
	if (existing && existing.state !== "destroyed") {
		if (existing.state === "stopped") {
			// Top-up path: `stopped → running` (Design) restarts the existing
			// stack — secrets and data are untouched, so this is just `start`.
			await start(cfg, accountId);
			return "running";
		}
		return existing.state;
	}

	const { inserted, apiPort } = await insertProvisioningTenant(
		cfg.db,
		accountId,
		acct8,
	);
	if (!inserted) {
		// Lost the race to another concurrent request for the same account.
		const row = await getTenant(cfg.db, accountId);
		return row?.state ?? "provisioning";
	}

	const dir = tenantDir(cfg, acct8);
	const socketDir = join(dir, "sockets");

	try {
		const accountReadKey = await resolveMintTenantKey(cfg)(accountId);
		const secrets = generateTenantSecrets();
		const env = buildTenantEnv({
			secrets,
			accountReadKey,
			hostedApiUrl: cfg.hostedApiUrl,
			tenantSocketDir: socketDir,
			apiPort,
		});
		writeSecretsToDisk(dir, socketDir, renderEnvFile(env));

		const result = await runCompose(
			[
				"-p",
				projectName(acct8),
				"-f",
				cfg.composeFile,
				"--env-file",
				join(dir, ".env"),
				"up",
				"-d",
				"--wait",
			],
			env,
		);
		if (result.code !== 0) {
			logger.error("workload.provisioner.up_failed", {
				accountId,
				acct8,
				stderr: result.stderr.slice(0, 2000),
			});
			throw new Error(
				`docker compose up failed for tenant-${acct8} (exit ${result.code})`,
			);
		}
	} catch (err) {
		await cleanupFailedProvision(cfg, runCompose, accountId, acct8, dir, err);
		throw err;
	}

	await setTenantState(cfg.db, accountId, "running");
	logger.info("workload.provisioner.up", { accountId, acct8 });
	return "running";
}

/** Best-effort teardown for a failed `up()` (review fix 5): a stuck
 *  `provisioning` row with no working stack would 503 every request for
 *  this account forever, and it would silently squat the allocated
 *  `api_port`. `compose down -v` failures here are logged, not thrown —
 *  the ORIGINAL error is what the caller needs to see; a cleanup failure on
 *  top of it just means the next `up()` retry's `compose up` may need to
 *  clean up a half-started project itself (compose handles that fine). */
async function cleanupFailedProvision(
	cfg: ProvisionerConfig,
	runCompose: RunCompose,
	accountId: string,
	acct8: string,
	dir: string,
	originalErr: unknown,
): Promise<void> {
	logger.error("workload.provisioner.up_failed_cleanup", {
		accountId,
		acct8,
		error:
			originalErr instanceof Error ? originalErr.message : String(originalErr),
	});
	try {
		await runCompose(
			[
				"-p",
				projectName(acct8),
				"-f",
				cfg.composeFile,
				"--env-file",
				join(dir, ".env"),
				"down",
				"-v",
			],
			{},
		);
	} catch (cleanupErr) {
		logger.warn("workload.provisioner.up_failed_cleanup_compose_down_error", {
			accountId,
			acct8,
			error:
				cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
		});
	}
	await deleteTenant(cfg.db, accountId);
}

/** `running → stopped`: stop every service except `postgres` (Design) so
 *  webhook delivery pauses and the memory meter stops, but tenant data is
 *  kept — a top-up just starts everything back up. */
export async function stop(
	cfg: ProvisionerConfig,
	accountId: string,
): Promise<void> {
	const runCompose = cfg.runCompose ?? spawnCompose;
	const acct8 = acct8For(accountId);
	const dir = tenantDir(cfg, acct8);
	const result = await runCompose(
		[
			"-p",
			projectName(acct8),
			"-f",
			cfg.composeFile,
			"--env-file",
			join(dir, ".env"),
			"stop",
			"api",
			"webhook-service",
			"migrate",
		],
		{},
	);
	if (result.code !== 0) {
		throw new Error(
			`docker compose stop failed for tenant-${acct8} (exit ${result.code})`,
		);
	}
	await setTenantState(cfg.db, accountId, "stopped");
	logger.info("workload.provisioner.stop", { accountId, acct8 });
}

/** `stopped → running`: undoes `stop()`. Also used by `up()` for a returning
 *  top-up on an already-provisioned account. */
export async function start(
	cfg: ProvisionerConfig,
	accountId: string,
): Promise<void> {
	const runCompose = cfg.runCompose ?? spawnCompose;
	const acct8 = acct8For(accountId);
	const dir = tenantDir(cfg, acct8);
	const result = await runCompose(
		[
			"-p",
			projectName(acct8),
			"-f",
			cfg.composeFile,
			"--env-file",
			join(dir, ".env"),
			"up",
			"-d",
			"--wait",
		],
		{},
	);
	if (result.code !== 0) {
		throw new Error(
			`docker compose up (restart) failed for tenant-${acct8} (exit ${result.code})`,
		);
	}
	await setTenantState(cfg.db, accountId, "running");
	logger.info("workload.provisioner.start", { accountId, acct8 });
}

/** `any → destroyed`: final `pg_dump` to R2 (Open, decided 2026-09-24), then
 *  `compose down -v` and the secrets directory is removed. Idempotent — a
 *  second call on an already-destroyed (or never-provisioned) account is a
 *  no-op `compose down` plus a control-DB delete that matches zero rows. */
export async function destroy(
	cfg: ProvisionerConfig,
	accountId: string,
): Promise<void> {
	const runCompose = cfg.runCompose ?? spawnCompose;
	const acct8 = acct8For(accountId);
	const dir = tenantDir(cfg, acct8);
	const result = await runCompose(
		[
			"-p",
			projectName(acct8),
			"-f",
			cfg.composeFile,
			"--env-file",
			join(dir, ".env"),
			"down",
			"-v",
		],
		{},
	);
	if (result.code !== 0) {
		throw new Error(
			`docker compose down failed for tenant-${acct8} (exit ${result.code})`,
		);
	}
	await deleteTenant(cfg.db, accountId);
	logger.info("workload.provisioner.destroy", { accountId, acct8 });
}

/**
 * The 5-minute zero-balance poll (Design: "balance check (every 5 min via
 * introspect `credits_ok=false`)"). `running & !ok → stop()`,
 * `stopped & ok → start()` (review fix 3a — this is what actually resumes a
 * topped-up account in the background; the gateway's own topped-up-while-
 * stopped path (review fix 3b) is the other half, for a caller who doesn't
 * want to wait for the next poll tick).
 *
 * One tenant's stop/start failure is logged and does not stop the poll from
 * processing every other tenant in the batch.
 */
export async function pollCredits(cfg: ProvisionerConfig): Promise<void> {
	const tenants = await listPollableTenants(cfg.db);
	if (tenants.length === 0) return;

	const checkCreditsOk = resolveCheckCreditsOk(cfg);
	const creditsOk = await checkCreditsOk(tenants.map((t) => t.account_id));

	for (const tenant of tenants) {
		const ok = creditsOk[tenant.account_id] ?? false;
		try {
			if (tenant.state === "running" && !ok) {
				await stop(cfg, tenant.account_id);
			} else if (tenant.state === "stopped" && ok) {
				await start(cfg, tenant.account_id);
			}
		} catch (err) {
			logger.error("workload.provisioner.poll_credits_transition_failed", {
				accountId: tenant.account_id,
				fromState: tenant.state,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
