/**
 * Tenant backups: a `pg_dump -Fc` of each tenant's own Postgres, streamed to
 * an S3-compatible bucket (R2 in prod) with Bun's built-in `S3Client`.
 *
 *   <prefix>/<acct8>/<YYYY-MM-DD>.dump         nightly, last 7 kept
 *   <prefix>/final/<acct8>/<YYYY-MM-DD>.dump   taken by `destroy()`, kept 30 days
 *
 * `final` can't collide with an acct8: acct8 is hex only.
 */

import { logger } from "@secondlayer/shared";

export const NIGHTLY_KEEP_DAYS = 7;
export const FINAL_KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The bucket operations backups need, injectable for tests. */
export interface BackupStore {
	/** Streams `body` to `key`. */
	upload(key: string, body: ReadableStream<Uint8Array>): Promise<void>;
	/** Every key under `prefix`. */
	list(prefix: string): Promise<string[]>;
	delete(key: string): Promise<void>;
}

/** A running `pg_dump`: its output stream and its exit code. */
export interface DumpProcess {
	stdout: ReadableStream<Uint8Array>;
	exited: Promise<number>;
}

export type SpawnDump = (acct8: string) => DumpProcess;

/** Real dump: `docker exec` into the tenant's own postgres container, the
 *  same access path the storage meter uses. Custom format (`-Fc`) so a
 *  restore can be selective. */
export const spawnTenantDump: SpawnDump = (acct8) => {
	const proc = Bun.spawn(
		[
			"docker",
			"exec",
			`tenant-${acct8}-postgres-1`,
			"pg_dump",
			"-Fc",
			"-U",
			"secondlayer",
			"-d",
			"secondlayer",
		],
		{ stdout: "pipe", stderr: "ignore" },
	);
	return { stdout: proc.stdout, exited: proc.exited };
};

export interface BackupConfig {
	store: BackupStore;
	/** Key prefix inside the bucket. */
	prefix: string;
	spawnDump?: SpawnDump;
}

/**
 * The store from `TENANT_BACKUP_*` env, or `null` when unset (backups off:
 * the nightly loop is skipped and `destroy()` refuses to run).
 *
 *   TENANT_BACKUP_BUCKET, TENANT_BACKUP_ENDPOINT,
 *   TENANT_BACKUP_ACCESS_KEY_ID, TENANT_BACKUP_SECRET_ACCESS_KEY,
 *   TENANT_BACKUP_PREFIX (default `tenant-backups`)
 */
export function backupConfigFromEnv(
	env: Record<string, string | undefined> = process.env,
): BackupConfig | null {
	const bucket = env.TENANT_BACKUP_BUCKET?.trim();
	const endpoint = env.TENANT_BACKUP_ENDPOINT?.trim();
	const accessKeyId = env.TENANT_BACKUP_ACCESS_KEY_ID?.trim();
	const secretAccessKey = env.TENANT_BACKUP_SECRET_ACCESS_KEY?.trim();
	if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
	const client = new Bun.S3Client({
		bucket,
		endpoint,
		accessKeyId,
		secretAccessKey,
	});
	return {
		store: s3BackupStore(client),
		prefix: env.TENANT_BACKUP_PREFIX?.trim() || "tenant-backups",
	};
}

export function s3BackupStore(client: Bun.S3Client): BackupStore {
	return {
		async upload(key, body) {
			const writer = client.file(key).writer({
				type: "application/octet-stream",
			});
			try {
				for await (const chunk of body) await writer.write(chunk);
			} catch (err) {
				await writer.end(err instanceof Error ? err : new Error(String(err)));
				throw err;
			}
			await writer.end();
		},
		async list(prefix) {
			const keys: string[] = [];
			let continuationToken: string | undefined;
			do {
				const page = await client.list({ prefix, continuationToken });
				for (const item of page.contents ?? []) keys.push(item.key);
				continuationToken = page.isTruncated
					? page.nextContinuationToken
					: undefined;
			} while (continuationToken);
			return keys;
		},
		async delete(key) {
			await client.delete(key);
		},
	};
}

function day(now: Date): string {
	return now.toISOString().slice(0, 10);
}

export function nightlyPrefix(cfg: BackupConfig, acct8: string): string {
	return `${cfg.prefix}/${acct8}/`;
}

export function finalPrefix(cfg: BackupConfig): string {
	return `${cfg.prefix}/final/`;
}

/** Dumps one tenant to `key`. Throws (and removes the partial object) when
 *  `pg_dump` exits non-zero, so a failed dump never looks like a backup. */
async function dumpTo(
	cfg: BackupConfig,
	acct8: string,
	key: string,
): Promise<void> {
	const dump = (cfg.spawnDump ?? spawnTenantDump)(acct8);
	await cfg.store.upload(key, dump.stdout);
	const code = await dump.exited;
	if (code !== 0) {
		await cfg.store.delete(key).catch(() => {});
		throw new Error(`pg_dump failed for tenant-${acct8} (exit ${code})`);
	}
}

/** Deletes keys under `prefix` whose `YYYY-MM-DD.dump` name is older than
 *  `keepDays` before `now`. Keys that don't parse are left alone. */
async function pruneOlderThan(
	store: BackupStore,
	prefix: string,
	keepDays: number,
	now: Date,
): Promise<string[]> {
	const cutoff = day(new Date(now.getTime() - keepDays * DAY_MS));
	const pruned: string[] = [];
	for (const key of await store.list(prefix)) {
		const match = key.match(/(\d{4}-\d{2}-\d{2})\.dump$/);
		if (!match?.[1] || match[1] > cutoff) continue;
		await store.delete(key);
		pruned.push(key);
	}
	return pruned;
}

/** Nightly: dump the tenant, then prune its dumps past `NIGHTLY_KEEP_DAYS`.
 *  Prunes only after a successful dump, so a run of failures never deletes
 *  the last good backup. */
export async function backupTenant(
	cfg: BackupConfig,
	acct8: string,
	now: Date = new Date(),
): Promise<{ key: string; pruned: string[] }> {
	const key = `${nightlyPrefix(cfg, acct8)}${day(now)}.dump`;
	await dumpTo(cfg, acct8, key);
	const pruned = await pruneOlderThan(
		cfg.store,
		nightlyPrefix(cfg, acct8),
		NIGHTLY_KEEP_DAYS,
		now,
	);
	logger.info("workload.backup.done", { acct8, key, pruned: pruned.length });
	return { key, pruned };
}

/** The dump `destroy()` takes before tearing a tenant down. */
export async function finalBackupTenant(
	cfg: BackupConfig,
	acct8: string,
	now: Date = new Date(),
): Promise<string> {
	const key = `${finalPrefix(cfg)}${acct8}/${day(now)}.dump`;
	await dumpTo(cfg, acct8, key);
	logger.info("workload.backup.final", { acct8, key });
	return key;
}

/** Drops destroy-time dumps past `FINAL_KEEP_DAYS`. Run by the nightly loop:
 *  a destroyed tenant has no row left to visit. */
export function pruneFinalBackups(
	cfg: BackupConfig,
	now: Date = new Date(),
): Promise<string[]> {
	return pruneOlderThan(cfg.store, finalPrefix(cfg), FINAL_KEEP_DAYS, now);
}
