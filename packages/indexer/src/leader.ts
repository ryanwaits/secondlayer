import { logger } from "@secondlayer/shared/logger";
import postgres from "postgres";

/**
 * Single-leader election via a Postgres session advisory lock.
 *
 * Exactly one process across the fleet holds `lockKey` and runs the leader-only
 * work (the singleton loops: integrity, tip-follower, dataset publishers).
 * Others poll and take over if the leader exits or its connection dies. The
 * lock lives on a dedicated long-lived connection — a pooled connection would
 * silently drop a session lock — and is released by closing that connection.
 */

/** Default advisory lock key for the indexer's singleton loops. */
export const INDEXER_LEADER_LOCK_KEY = 770_2026;

export type StopFn = () => void | Promise<void>;

/**
 * Backend for the advisory lock. Abstracted so the election logic is testable
 * without a database; the default is Postgres-backed.
 */
export type LeaderBackend = {
	/** Try to grab the lock without blocking. */
	tryAcquire(lockKey: number): Promise<boolean>;
	/** Liveness check; throws if the lock-holding connection is gone. */
	ping(): Promise<void>;
	/** Release the lock (closes the dedicated connection). */
	close(): Promise<void>;
};

function leaderDatabaseUrl(): string {
	return (
		process.env.SOURCE_DATABASE_URL ||
		process.env.DATABASE_URL ||
		"postgres://localhost:5432/secondlayer"
	);
}

/** Postgres-backed advisory lock on a dedicated connection. */
export function createPostgresLeaderBackend(): LeaderBackend {
	const url = leaderDatabaseUrl();
	const host = (() => {
		try {
			return new URL(url).hostname;
		} catch {
			return "";
		}
	})();
	const isLocal =
		host === "localhost" || host === "127.0.0.1" || !host.includes(".");
	// max:1 + idle_timeout:0 keeps one connection open so the session lock holds.
	const sql = postgres(url, {
		max: 1,
		idle_timeout: 0,
		ssl: isLocal
			? undefined
			: {
					rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
				},
	});
	return {
		async tryAcquire(lockKey) {
			const rows = await sql<{ locked: boolean }[]>`
				SELECT pg_try_advisory_lock(${lockKey}) AS locked
			`;
			return rows[0]?.locked === true;
		},
		async ping() {
			await sql`SELECT 1`;
		},
		async close() {
			// Closing the session releases all advisory locks it held.
			await sql.end({ timeout: 5 });
		},
	};
}

export type WithLeaderLockOptions = {
	pollMs?: number;
	heartbeatMs?: number;
	/** Injectable for tests; defaults to the Postgres backend. */
	createBackend?: () => LeaderBackend;
};

/**
 * Run `startWork` only while this process is leader. Returns a stop function
 * that ends election, stops the work, and releases the lock.
 */
export function withLeaderLock(
	lockKey: number,
	startWork: () => StopFn | Promise<StopFn>,
	opts: WithLeaderLockOptions = {},
): () => Promise<void> {
	const pollMs = opts.pollMs ?? 15_000;
	const heartbeatMs = opts.heartbeatMs ?? 10_000;
	const backend = (opts.createBackend ?? createPostgresLeaderBackend)();

	let stopped = false;
	let isLeader = false;
	let stopWork: StopFn | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	async function relinquish() {
		isLeader = false;
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (stopWork) {
			try {
				await stopWork();
			} catch (err) {
				logger.warn("Leader work stop failed", { error: String(err) });
			}
			stopWork = null;
		}
	}

	function startHeartbeat() {
		heartbeatTimer = setInterval(async () => {
			if (stopped || !isLeader) return;
			try {
				await backend.ping();
			} catch (err) {
				logger.warn("Leader heartbeat failed; relinquishing", {
					lockKey,
					error: String(err),
				});
				await relinquish();
			}
		}, heartbeatMs);
	}

	async function tryAcquire() {
		if (stopped || isLeader) return;
		try {
			if (await backend.tryAcquire(lockKey)) {
				isLeader = true;
				logger.info("Acquired leader lock", { lockKey });
				stopWork = await startWork();
				startHeartbeat();
			}
		} catch (err) {
			logger.warn("Leader lock acquire failed", {
				lockKey,
				error: String(err),
			});
		}
	}

	pollTimer = setInterval(tryAcquire, pollMs);
	void tryAcquire();

	return async () => {
		stopped = true;
		if (pollTimer) clearInterval(pollTimer);
		await relinquish();
		await backend.close().catch(() => {});
	};
}
