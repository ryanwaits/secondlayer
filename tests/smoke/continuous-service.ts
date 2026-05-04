import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Kysely, Migrator, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "../../packages/shared/src/db/types.ts";

const DEFAULT_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:5435/secondlayer";
const MIN_CONTINUOUS_RUN_MS = 60_000;

type EnvMap = Record<string, string | undefined>;

export type SmokeDatabase = {
	url: string;
	db: Kysely<Database>;
	close(): Promise<void>;
	drop(): Promise<void>;
};

export type RunningContinuousService = {
	stop(): Promise<void>;
	exited: Promise<{ exitCode: number }>;
	logs(): string;
};

export type ContinuousServiceProgress = {
	outputRows: number;
	expectedEventTypeRows: number;
	checkpoint: string | null;
	eventTypeCounts?: Record<string, number>;
};

export type ContinuousServiceSmokeSummary = {
	serviceName: string;
	elapsedMs: number;
	outputRowsWritten: number;
	expectedEventTypeRowsWritten: number;
	checkpointDelta: { before: string | null; after: string | null };
	before: ContinuousServiceProgress;
	after: ContinuousServiceProgress;
};

export type ContinuousServiceSmokeConfig = {
	serviceName: string;
	outputTable: string;
	expectedEventType: string;
	checkpointLabel: string;
	minRunMs?: number;
	timeoutMs?: number;
	pollIntervalMs?: number;
	minimumOutputWrites?: number;
	minimumExpectedEventTypeRows?: number;
	seed(): Promise<void>;
	startService(): Promise<RunningContinuousService> | RunningContinuousService;
	readProgress(): Promise<ContinuousServiceProgress>;
	checkpointAdvanced?(before: string | null, after: string | null): boolean;
};

export async function createSmokeDatabase(
	namePrefix = "secondlayer_smoke",
): Promise<SmokeDatabase> {
	const adminUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
	const databaseName = safeDatabaseName(namePrefix);
	const admin = postgres(adminUrl, { max: 1 });

	try {
		await admin.unsafe(`CREATE DATABASE ${databaseName}`);
	} catch (error) {
		throw new Error(
			`Smoke Postgres unavailable. Set DATABASE_URL or run local Postgres at ${DEFAULT_DATABASE_URL}.`,
			{ cause: error },
		);
	} finally {
		await admin.end();
	}

	const url = new URL(adminUrl);
	url.pathname = `/${databaseName}`;
	const databaseUrl = url.toString();
	const client = postgres(databaseUrl, { max: 5 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	let closed = false;

	try {
		await migrateSmokeDatabase(db);
	} catch (error) {
		await db.destroy().catch(() => undefined);
		await client.end().catch(() => undefined);
		await dropSmokeDatabase(adminUrl, databaseName).catch(() => undefined);
		throw error;
	}

	async function close(): Promise<void> {
		if (closed) return;
		closed = true;
		await db.destroy();
		await client.end();
	}

	async function drop(): Promise<void> {
		await close();
		await dropSmokeDatabase(adminUrl, databaseName);
	}

	return { url: databaseUrl, db, close, drop };
}

export async function getFreePort(): Promise<number> {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("ok"),
	});
	const port = server.port;
	server.stop();
	return port;
}

export function spawnContinuousService(opts: {
	command: string[];
	cwd: string;
	env?: EnvMap;
}): RunningContinuousService {
	const logParts: string[] = [];
	const subprocess = Bun.spawn({
		cmd: opts.command,
		cwd: opts.cwd,
		env: definedEnv({ ...process.env, ...opts.env }),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = drainStream(subprocess.stdout, logParts);
	const stderr = drainStream(subprocess.stderr, logParts);
	let stopped = false;

	async function stop(): Promise<void> {
		if (stopped) return;
		stopped = true;
		if (subprocess.exitCode === null) subprocess.kill("SIGTERM");

		await Promise.race([
			subprocess.exited,
			sleep(5_000).then(() => {
				if (subprocess.exitCode === null) subprocess.kill("SIGKILL");
			}),
		]);
		await subprocess.exited.catch(() => undefined);
		await Promise.allSettled([stdout, stderr]);
	}

	return {
		stop,
		exited: subprocess.exited.then((exitCode) => ({ exitCode })),
		logs: () => logParts.join(""),
	};
}

export async function runContinuousServiceSmoke(
	config: ContinuousServiceSmokeConfig,
): Promise<ContinuousServiceSmokeSummary> {
	const minRunMs = config.minRunMs ?? MIN_CONTINUOUS_RUN_MS;
	if (minRunMs < MIN_CONTINUOUS_RUN_MS) {
		throw new Error(
			`${config.serviceName} smoke minRunMs must be at least ${MIN_CONTINUOUS_RUN_MS}ms`,
		);
	}

	const timeoutMs = config.timeoutMs ?? minRunMs + 30_000;
	const pollIntervalMs = config.pollIntervalMs ?? 1_000;
	const deadline = Date.now() + timeoutMs;
	let service: RunningContinuousService | null = null;
	let earlyExit: { exitCode: number } | null = null;

	try {
		await beforeDeadline(config.seed(), deadline, config.serviceName);
		const before = await beforeDeadline(
			config.readProgress(),
			deadline,
			config.serviceName,
		);
		const startedAt = Date.now();
		service = await beforeDeadline(
			Promise.resolve(config.startService()),
			deadline,
			config.serviceName,
		);
		void service.exited.then((exit) => {
			earlyExit = exit;
		});

		while (Date.now() - startedAt < minRunMs) {
			if (earlyExit)
				throw serviceExitedError(config.serviceName, earlyExit, service);
			await beforeDeadline(config.readProgress(), deadline, config.serviceName);
			await sleep(
				Math.min(pollIntervalMs, minRunMs - (Date.now() - startedAt)),
			);
		}

		if (earlyExit)
			throw serviceExitedError(config.serviceName, earlyExit, service);
		const after = await beforeDeadline(
			config.readProgress(),
			deadline,
			config.serviceName,
		);
		const elapsedMs = Date.now() - startedAt;
		const summary = summarize(config.serviceName, before, after, elapsedMs);
		assertContinuousServiceSmoke(config, summary);
		return summary;
	} finally {
		if (service) await service.stop();
	}
}

async function migrateSmokeDatabase(db: Kysely<Database>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`SET statement_timeout = '60s'`.execute(db);

	const migrationFolder = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../packages/shared/migrations",
	);
	const migrator = new Migrator({
		db,
		provider: new FileMigrationProvider({
			fs,
			path: { join },
			migrationFolder,
		}),
	});
	const { error } = await migrator.migrateToLatest();
	if (error) {
		throw new Error("Smoke database migration failed", { cause: error });
	}
}

async function dropSmokeDatabase(
	adminUrl: string,
	databaseName: string,
): Promise<void> {
	const admin = postgres(adminUrl, { max: 1 });
	try {
		await admin.unsafe(`
			SELECT pg_terminate_backend(pid)
			FROM pg_stat_activity
			WHERE datname = '${databaseName}'
				AND pid <> pg_backend_pid()
		`);
		await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName}`);
	} finally {
		await admin.end();
	}
}

function safeDatabaseName(prefix: string): string {
	const normalized = prefix.toLowerCase().replace(/[^a-z0-9_]/g, "_");
	const name = `${normalized}_${Date.now().toString(36)}_${Math.random()
		.toString(36)
		.slice(2, 8)}`;
	if (!/^[a-z][a-z0-9_]*$/.test(name)) {
		throw new Error(`Unsafe smoke database name: ${name}`);
	}
	return name;
}

function definedEnv(env: EnvMap): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) result[key] = value;
	}
	return result;
}

async function drainStream(
	stream: ReadableStream<Uint8Array> | null,
	logParts: string[],
): Promise<void> {
	if (!stream) return;
	const decoder = new TextDecoder();
	for await (const chunk of stream) {
		logParts.push(decoder.decode(chunk, { stream: true }));
	}
	logParts.push(decoder.decode());
}

function summarize(
	serviceName: string,
	before: ContinuousServiceProgress,
	after: ContinuousServiceProgress,
	elapsedMs: number,
): ContinuousServiceSmokeSummary {
	return {
		serviceName,
		elapsedMs,
		outputRowsWritten: after.outputRows - before.outputRows,
		expectedEventTypeRowsWritten:
			after.expectedEventTypeRows - before.expectedEventTypeRows,
		checkpointDelta: { before: before.checkpoint, after: after.checkpoint },
		before,
		after,
	};
}

function assertContinuousServiceSmoke(
	config: ContinuousServiceSmokeConfig,
	summary: ContinuousServiceSmokeSummary,
): void {
	const failures: string[] = [];
	const minimumOutputWrites = config.minimumOutputWrites ?? 1;
	const minimumExpectedEventTypeRows = config.minimumExpectedEventTypeRows ?? 1;
	const checkpointAdvanced =
		config.checkpointAdvanced?.(
			summary.checkpointDelta.before,
			summary.checkpointDelta.after,
		) ??
		(summary.checkpointDelta.after !== null &&
			summary.checkpointDelta.after !== summary.checkpointDelta.before);

	if (summary.outputRowsWritten < minimumOutputWrites) {
		failures.push(
			`${config.outputTable} write assertion failed: expected >=${minimumOutputWrites} new rows, before=${summary.before.outputRows}, after=${summary.after.outputRows}`,
		);
	}
	if (summary.expectedEventTypeRowsWritten < minimumExpectedEventTypeRows) {
		failures.push(
			`event_type assertion failed: expected >=${minimumExpectedEventTypeRows} new ${config.expectedEventType} rows, before=${summary.before.expectedEventTypeRows}, after=${summary.after.expectedEventTypeRows}`,
		);
	}
	if (!checkpointAdvanced) {
		failures.push(
			`${config.checkpointLabel} checkpoint assertion failed: expected checkpoint to advance, before=${summary.checkpointDelta.before ?? "null"}, after=${summary.checkpointDelta.after ?? "null"}`,
		);
	}

	if (failures.length > 0) {
		throw new Error(`[${config.serviceName}] ${failures.join("; ")}`);
	}
}

async function beforeDeadline<T>(
	promise: Promise<T>,
	deadline: number,
	serviceName: string,
): Promise<T> {
	const remainingMs = deadline - Date.now();
	if (remainingMs <= 0) {
		throw new Error(`[${serviceName}] smoke timed out`);
	}

	let timeout: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`[${serviceName}] smoke timed out`)),
					remainingMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function serviceExitedError(
	serviceName: string,
	exit: { exitCode: number },
	service: RunningContinuousService,
): Error {
	const logs = service.logs().slice(-4_000);
	return new Error(
		`[${serviceName}] service exited before minimum run: exitCode=${exit.exitCode}${logs ? `\n${logs}` : ""}`,
	);
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}
