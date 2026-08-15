/**
 * `secondlayer backup` / `secondlayer restore` — the operator lifecycle the
 * self-host docs previously described but did not ship.
 *
 * The index can be rebuilt from the archive. The keys cannot. So the bundle
 * carries both, the keys are encrypted under an operator passphrase, and a
 * restore refuses before writing anything if the key the instance will actually
 * use is not the key the data was encrypted with.
 */
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	type BackupManifest,
	decryptBundle,
	encryptBundle,
	keyMatchesCanary,
	planBackup,
	precheckRestore,
	sealKeyCanary,
} from "@secondlayer/shared/runtime";
import type { Command } from "commander";
import { note, output, printError, success, warn } from "../lib/output.ts";

export const BACKUP_EXIT = { OK: 0, FAILED: 1, REFUSED: 2 } as const;

const MANIFEST_FILE = "manifest.json";
const DB_FILE = "db.dump";
const SECRETS_FILE = "secrets.enc";

/**
 * Keys a restore needs to make the instance whole. Sourced from what
 * `secondlayer init` generates plus the runtime's declared secrets — losing any
 * of them is unrecoverable in a way losing the index is not.
 */
const SECRET_ENV_KEYS = [
	"INSTANCE_TOKEN",
	"SECONDLAYER_SECRETS_KEY",
	"STREAMS_SIGNING_PRIVATE_KEY",
	"SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY",
	"SL_API_KEY",
	"ARCHIVE_SIGNING_PUBLIC_KEY",
] as const;

function readSecretsKey(): string | undefined {
	// Read the raw env deliberately. Going through the shared secrets module
	// would resolve — and in OSS mode GENERATE AND PERSIST — a key, which is the
	// opposite of what a backup should do.
	const key = process.env.SECONDLAYER_SECRETS_KEY?.trim();
	return key ? key : undefined;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function readScope(): Promise<{
	network: string;
	fromHeight: number;
	toHeight: number | null;
}> {
	const db = getDb();
	const bounds = await sql<{
		min: string | null;
		max: string | null;
	}>`SELECT MIN(height)::text AS min, MAX(height)::text AS max FROM blocks WHERE canonical = true`.execute(
		db,
	);
	const row = bounds.rows[0];
	const network = process.env.STACKS_NETWORK ?? "mainnet";
	return {
		network,
		fromHeight: row?.min ? Number(row.min) : 0,
		toHeight: row?.max ? Number(row.max) : null,
	};
}

function requireDatabaseUrl(): string {
	const url = process.env.DATABASE_URL?.trim();
	if (!url) throw new Error("DATABASE_URL is required");
	return url;
}

async function runProcess(
	cmd: string[],
	label: string,
): Promise<{ ok: boolean; stderr: string }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		return { ok: false, stderr: `${label} exited ${code}: ${stderr.trim()}` };
	}
	return { ok: true, stderr };
}

export function attachBackupCommand(cmd: Command): Command {
	return cmd
		.requiredOption("--out <dir>", "directory to write the bundle into")
		.option(
			"--passphrase <passphrase>",
			"encrypt bundled secrets (or set SECONDLAYER_BACKUP_PASSPHRASE)",
		)
		.option("--no-secrets", "omit keys; the bundle restores data only")
		.option("--json", "Output as JSON")
		.action(async (opts) => {
			try {
				await runBackup(opts);
			} catch (error) {
				printError(error instanceof Error ? error.message : String(error));
				process.exit(BACKUP_EXIT.FAILED);
			}
		});
}

async function runBackup(opts: {
	out: string;
	passphrase?: string;
	secrets?: boolean;
	json?: boolean;
}): Promise<void> {
	const databaseUrl = requireDatabaseUrl();
	const includeSecrets = opts.secrets !== false;
	const passphrase =
		opts.passphrase ?? process.env.SECONDLAYER_BACKUP_PASSPHRASE ?? "";
	const secretsKey = readSecretsKey();

	if (includeSecrets && !secretsKey) {
		printError(
			"SECONDLAYER_SECRETS_KEY is not set, so this backup cannot carry the keys that decrypt your data. Set it, or pass --no-secrets to take a data-only bundle.",
		);
		process.exit(BACKUP_EXIT.REFUSED);
	}

	const scope = await readScope();
	const plan = planBackup({
		network: scope.network,
		fromHeight: scope.fromHeight,
		toHeight: scope.toHeight,
		includeSecrets,
		secretsEncrypted: includeSecrets && passphrase.length > 0,
		canary: secretsKey ? sealKeyCanary(secretsKey) : undefined,
	});
	if (!plan.ok) {
		printError(plan.reason);
		process.exit(BACKUP_EXIT.REFUSED);
	}

	const outDir = resolve(opts.out);
	mkdirSync(outDir, { recursive: true });

	console.error("dumping database…");
	const dumpPath = join(outDir, DB_FILE);
	const dump = await runProcess(
		["pg_dump", "-Fc", "--no-owner", "--no-acl", "-f", dumpPath, databaseUrl],
		"pg_dump",
	);
	if (!dump.ok) {
		printError(dump.stderr);
		process.exit(BACKUP_EXIT.FAILED);
	}

	const manifest: BackupManifest = {
		...plan.manifest,
		db: {
			file: DB_FILE,
			sha256: sha256File(dumpPath),
			bytes: statSync(dumpPath).size,
			format: "pg_dump-custom",
		},
	};

	if (includeSecrets && secretsKey) {
		const lines = SECRET_ENV_KEYS.filter((k) => process.env[k]).map(
			(k) => `${k}=${process.env[k]}`,
		);
		const sealed = encryptBundle(lines.join("\n"), passphrase);
		const secretsPath = join(outDir, SECRETS_FILE);
		writeFileSync(secretsPath, sealed);
		chmodSync(secretsPath, 0o600);
		manifest.secrets = {
			file: SECRETS_FILE,
			encrypted: true,
			canary: sealKeyCanary(secretsKey),
		};
	}

	writeFileSync(
		join(outDir, MANIFEST_FILE),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	output({
		json: opts.json,
		data: { out: outDir, manifest },
		human: () => {
			success(`backup written to ${outDir}`);
			note(
				`blocks ${manifest.scope.from_height}–${manifest.scope.to_height ?? "?"} · ${((manifest.db?.bytes ?? 0) / 1024 ** 2) | 0} MB`,
			);
			if (!manifest.secrets) {
				warn(
					"no keys in this bundle — it can restore data, but not a working instance",
				);
			} else {
				note("keys are encrypted; keep the passphrase somewhere else");
			}
		},
	});
}

export function attachRestoreCommand(cmd: Command): Command {
	return cmd
		.requiredOption("--from <dir>", "bundle directory to restore from")
		.option(
			"--passphrase <passphrase>",
			"decrypt bundled secrets (or set SECONDLAYER_BACKUP_PASSPHRASE)",
		)
		.option("--apply", "actually restore (default is a dry run)")
		.option("--force", "restore over a database that already holds chain data")
		.option("--json", "Output as JSON")
		.action(async (opts) => {
			try {
				await runRestore(opts);
			} catch (error) {
				printError(error instanceof Error ? error.message : String(error));
				process.exit(BACKUP_EXIT.FAILED);
			}
		});
}

async function runRestore(opts: {
	from: string;
	passphrase?: string;
	apply?: boolean;
	force?: boolean;
	json?: boolean;
}): Promise<void> {
	const databaseUrl = requireDatabaseUrl();
	const dir = resolve(opts.from);
	const manifestPath = join(dir, MANIFEST_FILE);
	if (!existsSync(manifestPath)) {
		printError(`no ${MANIFEST_FILE} in ${dir}`);
		process.exit(BACKUP_EXIT.REFUSED);
	}
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as BackupManifest;

	const dumpPath = join(dir, manifest.db?.file ?? DB_FILE);
	if (manifest.db && sha256File(dumpPath) !== manifest.db.sha256) {
		printError(
			"the database dump does not match the digest in the manifest; this bundle is corrupt or truncated",
		);
		process.exit(BACKUP_EXIT.REFUSED);
	}

	// The key that matters is the one THIS instance will run with, not the one
	// inside the bundle — checking the bundle against its own key would always
	// pass and prove nothing.
	const envKey = readSecretsKey();
	let bundleKey: string | undefined;
	if (manifest.secrets) {
		const passphrase =
			opts.passphrase ?? process.env.SECONDLAYER_BACKUP_PASSPHRASE ?? "";
		if (!passphrase) {
			printError(
				"this bundle carries encrypted keys; supply --passphrase to read them",
			);
			process.exit(BACKUP_EXIT.REFUSED);
		}
		try {
			const env = decryptBundle(
				readFileSync(join(dir, manifest.secrets.file)),
				passphrase,
			);
			bundleKey = env
				.split("\n")
				.find((l) => l.startsWith("SECONDLAYER_SECRETS_KEY="))
				?.slice("SECONDLAYER_SECRETS_KEY=".length)
				.trim();
		} catch {
			printError("could not decrypt the secrets bundle — wrong passphrase?");
			process.exit(BACKUP_EXIT.REFUSED);
		}
	}

	if (
		envKey &&
		manifest.secrets &&
		!keyMatchesCanary(manifest.secrets.canary, envKey)
	) {
		printError(
			"SECONDLAYER_SECRETS_KEY in this environment is NOT the key this backup was taken with. Restoring would leave every encrypted column unreadable. Unset it to install the bundle's key, or point this restore at the matching instance.",
		);
		process.exit(BACKUP_EXIT.REFUSED);
	}

	const db = getDb();
	// A wiped host is the headline restore target, and there the schema does not
	// exist yet — so ask the catalog first. Counting rows in a missing table
	// throws at parse time, which would fail the exact case this command is for.
	const present = await sql<{
		present: boolean;
	}>`SELECT to_regclass('public.blocks') IS NOT NULL AS present`.execute(db);
	let targetIsEmpty = true;
	if (present.rows[0]?.present) {
		const existing = await sql<{
			count: string;
		}>`SELECT COUNT(*)::text AS count FROM blocks`.execute(db);
		targetIsEmpty = (existing.rows[0]?.count ?? "0") === "0";
	}

	const check = precheckRestore({
		manifest,
		targetNetwork: process.env.STACKS_NETWORK ?? "mainnet",
		targetIsEmpty,
		force: opts.force === true,
		secretsKeyHex: envKey ?? bundleKey,
	});
	if (!check.ok) {
		printError(check.reason);
		process.exit(BACKUP_EXIT.REFUSED);
	}

	if (!opts.apply) {
		output({
			json: opts.json,
			data: { dryRun: true, manifest, targetIsEmpty },
			human: () => {
				note("dry run — nothing written. Pass --apply to restore.");
				note(
					`would restore ${manifest.network} blocks ${manifest.scope.from_height}–${manifest.scope.to_height ?? "?"}`,
				);
				if (bundleKey && !envKey) {
					note(
						"after restoring, install the bundle's keys before starting the runtime",
					);
				}
			},
		});
		return;
	}

	console.error("restoring database…");
	const restore = await runProcess(
		[
			"pg_restore",
			"--no-owner",
			"--no-acl",
			"--clean",
			"--if-exists",
			"-d",
			databaseUrl,
			dumpPath,
		],
		"pg_restore",
	);
	if (!restore.ok) {
		printError(restore.stderr);
		process.exit(BACKUP_EXIT.FAILED);
	}

	output({
		json: opts.json,
		data: { restored: true, manifest },
		human: () => {
			success("restore complete");
			if (bundleKey && !envKey) {
				warn(
					"set SECONDLAYER_SECRETS_KEY from the bundle before starting the runtime, or it will generate a new one and the restored data will not decrypt",
				);
			}
			note("verify with: secondlayer verify all --against <manifest>");
		},
	});
}

export function registerBackupCommand(program: Command): void {
	attachBackupCommand(
		program
			.command("backup")
			.description("Write a restorable bundle: index, keys, and scope"),
	);
}

export function registerRestoreCommand(program: Command): void {
	attachRestoreCommand(
		program
			.command("restore")
			.description("Restore an instance from a backup bundle"),
	);
}
