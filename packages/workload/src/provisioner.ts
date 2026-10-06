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
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
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
	listProvisioningTenants,
	setTenantImageSha,
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

/** First octet pair of the pool tenant networks are carved from:
 *  `10.64.0.0/10`, split into /24s. Chosen to sit clear of Docker's default
 *  address pools (172.17-31.0.0/16 and 192.168.0.0/16, which compose's own
 *  networks and any `default` network draw from) and of the Hetzner metadata
 *  range. The host firewall (`docker/workload-host/docker-user-egress.sh`)
 *  drops container-originated traffic to 10.0.0.0/8, which cannot touch a
 *  tenant's own api/postgres traffic: that stays on one bridge, which the
 *  firewall accepts before the private-range drops. */
const TENANT_NETWORK_FIRST_OCTET = 10;
const TENANT_NETWORK_SECOND_OCTET_BASE = 64;
/** 64 second-octet values x 256 third-octet values. */
export const TENANT_NETWORK_CAPACITY = 64 * 256;

/** The private /24 and static postgres address for the tenant whose
 *  `subnet_idx` (control DB, allocated once from a never-reused sequence) is
 *  `idx`. Index 0 is never allocated (the sequence starts at 1), so the pool
 *  keeps `10.64.0.0/24` free. */
export function tenantNetwork(idx: number): { subnet: string; pgIp: string } {
	if (!Number.isInteger(idx) || idx < 1 || idx >= TENANT_NETWORK_CAPACITY) {
		throw new Error(`tenant network index out of range: ${idx}`);
	}
	const second = TENANT_NETWORK_SECOND_OCTET_BASE + (idx >> 8);
	const third = idx & 255;
	const prefix = `${TENANT_NETWORK_FIRST_OCTET}.${second}.${third}`;
	return { subnet: `${prefix}.0/24`, pgIp: `${prefix}.10` };
}

/**
 * The compose `--env-file` contents for one tenant. Two dedicated account
 * keys are minted for this account (`mintTenantKey`,
 * `POST /internal/keys/tenant`), never the customer's own presented key
 * ("The customer's key never reaches the stack"):
 * - `accountReadKey` (`hosted-stack`, internal, unmetered): `webhook-service`
 *   only. It imports no customer code.
 * - `subgraphReadKey` (`hosted-subgraphs`, metered): everything that runs
 *   customer code (`api`, `subgraph-processor`). Its reads bill the account's
 *   allowance and spend cap like any other key.
 */
export function buildTenantEnv(opts: {
	secrets: TenantSecrets;
	accountReadKey: string;
	subgraphReadKey: string;
	hostedApiUrl: string;
	tenantSocketDir: string;
	apiPort: number;
	subnetIdx: number;
}): Record<string, string> {
	const network = tenantNetwork(opts.subnetIdx);
	return {
		POSTGRES_PASSWORD: opts.secrets.postgresPassword,
		INSTANCE_TOKEN: opts.secrets.instanceToken,
		SECONDLAYER_SECRETS_KEY: opts.secrets.secondlayerSecretsKey,
		STREAMS_SIGNING_PRIVATE_KEY: opts.secrets.streamsSigningPrivateKey,
		SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY:
			opts.secrets.webhookSigningPrivateKey,
		HOSTED_API_URL: opts.hostedApiUrl,
		TENANT_HOSTED_READ_KEY: opts.accountReadKey,
		TENANT_SUBGRAPH_READ_KEY: opts.subgraphReadKey,
		TENANT_SUBNET: network.subnet,
		TENANT_PG_IP: network.pgIp,
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

/** Inverse of `renderEnvFile`: `KEY=value` lines, literal `\n` back to a
 *  newline (PEM keys). Blank lines and `#` comments are skipped. */
export function parseEnvFile(contents: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const line of contents.split("\n")) {
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		env[line.slice(0, eq)] = line.slice(eq + 1).replace(/\\n/g, "\n");
	}
	return env;
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

export type TenantKeyName = "hosted-stack" | "hosted-subgraphs";

export type MintTenantKey = (
	accountId: string,
	name: TenantKeyName,
) => Promise<string>;

/** Real implementation: `POST /internal/keys/tenant` on app-server (Design
 *  fix: mint a DEDICATED key for the tenant rather than forwarding the
 *  customer's own presented key into the stack). */
export function makeMintTenantKey(
	hostedApiUrl: string,
	workloadHostKey: string,
	fetchImpl: FetchLike = fetch,
): MintTenantKey {
	return async (accountId: string, name: TenantKeyName): Promise<string> => {
		const res = await fetchImpl(
			`${hostedApiUrl.replace(/\/+$/, "")}/internal/keys/tenant`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${workloadHostKey}`,
				},
				body: JSON.stringify({ account_id: accountId, name }),
			},
		);
		if (!res.ok) {
			throw new Error(`mint tenant key (${name}) failed: ${res.status}`);
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
	/** The current deployed-image target (`upgrade.ts`'s `resolveTargetSha`,
	 *  cached in memory by the caller) — a function, not a fixed value, so
	 *  every `runCompose` call sees whatever `/health` reported most
	 *  recently, never a sha captured once at process start. `null` before
	 *  the first successful resolution: `up()`/`start()` refuse to run
	 *  compose against an undetermined target rather than pass an empty
	 *  `WORKLOAD_IMAGE_TAG`. */
	getTargetSha: () => string | null;
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

/** Exported for `upgrade.ts`, which drives the same compose project from a
 *  separate loop (the 5-minute rolling upgrade) and must resolve identical
 *  paths/names — never its own copy that could drift from this one. */
export function tenantDir(cfg: ProvisionerConfig, acct8: string): string {
	return join(cfg.secretsRoot, acct8);
}

export function projectName(acct8: string): string {
	return `tenant-${acct8}`;
}

/** Services every lifecycle operation addresses by name. `volume-init` is a
 *  one-shot that has already exited, so it is never stopped or pulled. */
export const TENANT_SERVICES = [
	"migrate",
	"api",
	"webhook-service",
	"subgraph-processor",
] as const;

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

/** Every compose call needs SOME `WORKLOAD_IMAGE_TAG` — the file interpolates
 *  it up front, before acting on any subcommand (plan 064). Throws rather
 *  than let compose fail with its own less legible "variable is not set"
 *  error when no target has resolved yet. */
function requireTargetSha(
	cfg: ProvisionerConfig,
	accountId: string,
	op: string,
): string {
	const sha = cfg.getTargetSha();
	if (!sha) {
		logger.error("workload.provisioner.op_refused_no_target", {
			accountId,
			op,
		});
		throw new Error(
			`refusing to ${op} tenant for ${accountId}: no resolved image target yet`,
		);
	}
	return sha;
}

/**
 * Brings an existing tenant's `.env` up to the shape the current template
 * needs: the metered subgraph key and the per-tenant network vars. A tenant
 * provisioned before subgraph hosting has neither, and `start()` /
 * `upgradeTenants` build their own compose calls from that file.
 *
 * The network vars are derived from the control-DB row (no network call), so
 * they are always written, which keeps compose's required-var check from
 * failing the WHOLE project. The key is minted only when absent (a mint
 * rotates the previous key). Never throws: a failed mint is logged as
 * `workload.tenant_env_backfill_failed` and the old env stays in place, so one
 * bad mint can't abort an upgrade round or stop a webhook tenant. The
 * processor fails to start for that tenant alone and the next round retries.
 */
export async function ensureTenantEnv(
	cfg: ProvisionerConfig,
	accountId: string,
): Promise<void> {
	try {
		const row = await getTenant(cfg.db, accountId);
		if (!row) return;
		const acct8 = acct8For(accountId);
		const envPath = join(tenantDir(cfg, acct8), ".env");
		const current = parseEnvFile(readFileSync(envPath, "utf8"));
		const next = { ...current };

		const network = tenantNetwork(row.subnet_idx);
		next.TENANT_SUBNET ||= network.subnet;
		next.TENANT_PG_IP ||= network.pgIp;

		let mintError: unknown;
		if (!next.TENANT_SUBGRAPH_READ_KEY) {
			try {
				next.TENANT_SUBGRAPH_READ_KEY = await resolveMintTenantKey(cfg)(
					accountId,
					"hosted-subgraphs",
				);
			} catch (err) {
				mintError = err;
			}
		}

		if (renderEnvFile(next) !== renderEnvFile(current)) {
			const tmp = `${envPath}.tmp`;
			writeFileSync(tmp, renderEnvFile(next), { mode: 0o600 });
			chmodSync(tmp, 0o600);
			renameSync(tmp, envPath);
			logger.info("workload.tenant_env_backfilled", { accountId, acct8 });
		}
		if (mintError) throw mintError;
	} catch (err) {
		logger.warn("workload.tenant_env_backfill_failed", {
			accountId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * `none → provisioning → running` (Design). Idempotent: a tenant already
 * `running` returns immediately; a tenant mid-`provisioning` (a concurrent
 * request raced this one) is left alone rather than double-provisioned —
 * the control DB's PK is the single point of truth for "who provisions."
 *
 * Never takes the customer's presented key — it mints dedicated
 * `hosted-stack` and `hosted-subgraphs` keys for the account itself (`resolveMintTenantKey`,
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

	// Checked before the row insert (not just before the compose call) so an
	// undetermined target never leaves behind a stuck `provisioning` row that
	// would 503 this account forever (plan 064).
	const targetSha = requireTargetSha(cfg, accountId, "provision");

	const { inserted, apiPort, subnetIdx } = await insertProvisioningTenant(
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
		const mint = resolveMintTenantKey(cfg);
		const [accountReadKey, subgraphReadKey] = await Promise.all([
			mint(accountId, "hosted-stack"),
			mint(accountId, "hosted-subgraphs"),
		]);
		const secrets = generateTenantSecrets();
		const env = buildTenantEnv({
			secrets,
			accountReadKey,
			subgraphReadKey,
			hostedApiUrl: cfg.hostedApiUrl,
			tenantSocketDir: socketDir,
			apiPort,
			subnetIdx,
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
			{ ...env, WORKLOAD_IMAGE_TAG: targetSha },
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
		await cleanupFailedProvision(
			cfg,
			runCompose,
			accountId,
			acct8,
			targetSha,
			err,
		);
		throw err;
	}

	await setTenantState(cfg.db, accountId, "running");
	await setTenantImageSha(cfg.db, accountId, targetSha);
	logger.info("workload.provisioner.up", {
		accountId,
		acct8,
		imageSha: targetSha,
	});
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
	targetSha: string,
	originalErr: unknown,
): Promise<void> {
	logger.error("workload.provisioner.up_failed_cleanup", {
		accountId,
		acct8,
		error:
			originalErr instanceof Error ? originalErr.message : String(originalErr),
	});
	await teardownProvision(cfg, runCompose, accountId, acct8, targetSha);
}

/** Shared by the failed-`up()` cleanup and the boot sweep: `compose down -v`
 *  for the tenant's project (skipped when there is no image tag to give
 *  compose), then delete the control-db row. Never throws on a compose
 *  failure. */
async function teardownProvision(
	cfg: ProvisionerConfig,
	runCompose: RunCompose,
	accountId: string,
	acct8: string,
	targetSha: string | null,
): Promise<void> {
	if (targetSha) {
		try {
			await runCompose(
				[
					"-p",
					projectName(acct8),
					"-f",
					cfg.composeFile,
					"--env-file",
					join(tenantDir(cfg, acct8), ".env"),
					"down",
					"-v",
				],
				{ WORKLOAD_IMAGE_TAG: targetSha },
			);
		} catch (cleanupErr) {
			logger.warn("workload.provisioner.up_failed_cleanup_compose_down_error", {
				accountId,
				acct8,
				error:
					cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
			});
		}
	} else {
		logger.warn("workload.provisioner.teardown_compose_skipped_no_target", {
			accountId,
			acct8,
		});
	}
	await deleteTenant(cfg.db, accountId);
}

/** Boot sweep: a restart mid-`up()` kills the fire-and-forget provision, so
 *  every `provisioning` row found before the gateway starts is orphaned (one
 *  process owns provisioning; nothing is in flight yet). Tear each down the
 *  same way a failed `up()` does so the next request re-provisions from
 *  scratch instead of 503ing forever. Must run before `Bun.serve`. */
export async function recoverInterruptedProvisions(
	cfg: ProvisionerConfig,
): Promise<number> {
	const runCompose = cfg.runCompose ?? spawnCompose;
	const rows = await listProvisioningTenants(cfg.db);
	for (const row of rows) {
		const acct8 = acct8For(row.account_id);
		await teardownProvision(
			cfg,
			runCompose,
			row.account_id,
			acct8,
			cfg.getTargetSha(),
		);
		logger.warn("workload.provisioner.recovered_interrupted", {
			accountId: row.account_id,
			acct8,
		});
	}
	return rows.length;
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
	// `stop` doesn't change what's running, but compose still interpolates
	// the WHOLE file (including the `api`/`webhook-service`/`migrate` image
	// lines) before it can act on any service — a required var with nothing
	// supplied fails parsing even for a subcommand that never touches the
	// image (plan 064). Any resolvable value works here.
	const workloadImageTag = requireTargetSha(cfg, accountId, "stop");
	const result = await runCompose(
		[
			"-p",
			projectName(acct8),
			"-f",
			cfg.composeFile,
			"--env-file",
			join(dir, ".env"),
			"stop",
			...TENANT_SERVICES,
		],
		{ WORKLOAD_IMAGE_TAG: workloadImageTag },
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
	// Stopped tenants upgrade lazily (plan 064, Design): every restart uses
	// whatever's currently deployed, not whatever this tenant last ran.
	const targetSha = requireTargetSha(cfg, accountId, "start");
	await ensureTenantEnv(cfg, accountId);
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
		{ WORKLOAD_IMAGE_TAG: targetSha },
	);
	if (result.code !== 0) {
		throw new Error(
			`docker compose up (restart) failed for tenant-${acct8} (exit ${result.code})`,
		);
	}
	await setTenantState(cfg.db, accountId, "running");
	await setTenantImageSha(cfg.db, accountId, targetSha);
	logger.info("workload.provisioner.start", {
		accountId,
		acct8,
		imageSha: targetSha,
	});
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
	const workloadImageTag = requireTargetSha(cfg, accountId, "destroy");
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
		{ WORKLOAD_IMAGE_TAG: workloadImageTag },
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
