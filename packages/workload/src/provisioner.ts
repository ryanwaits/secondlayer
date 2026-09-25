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
	setTenantState,
} from "./control-db.ts";

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
 * The compose `--env-file` contents for one tenant. `accountReadKey` is that
 * account's own hosted credential (D6): the tenant's `webhook-service` reads
 * the HOSTED Index/Streams API with it, so a leak only leaks reads the
 * account already owns, and those reads meter against the same account
 * (step 5, "Hosted reads by the stack" — already billed on app-server).
 */
export function buildTenantEnv(opts: {
	secrets: TenantSecrets;
	accountReadKey: string;
	hostedApiUrl: string;
	tenantSocketDir: string;
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

export interface ProvisionerConfig {
	db: postgres.Sql;
	/** Root-only directory holding one subdirectory per tenant. */
	secretsRoot: string;
	composeFile: string;
	hostedApiUrl: string;
	runCompose?: RunCompose;
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
 */
export async function up(
	cfg: ProvisionerConfig,
	accountId: string,
	accountReadKey: string,
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

	const { inserted } = await insertProvisioningTenant(cfg.db, accountId, acct8);
	if (!inserted) {
		// Lost the race to another concurrent request for the same account.
		const row = await getTenant(cfg.db, accountId);
		return row?.state ?? "provisioning";
	}

	const dir = tenantDir(cfg, acct8);
	const socketDir = join(dir, "sockets");
	const secrets = generateTenantSecrets();
	const env = buildTenantEnv({
		secrets,
		accountReadKey,
		hostedApiUrl: cfg.hostedApiUrl,
		tenantSocketDir: socketDir,
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

	await setTenantState(cfg.db, accountId, "running");
	logger.info("workload.provisioner.up", { accountId, acct8 });
	return "running";
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
