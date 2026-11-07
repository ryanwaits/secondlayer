/**
 * The workload host's background ticks, as factories with injected effects so
 * each one is testable without a docker daemon or an app-server. `index.ts`
 * wires the real effects and schedules them.
 *
 * The daily jobs (storage sample, backup) are short ticks that read their
 * per-tenant "last done" marker from the control DB: a restart the same day
 * neither skips the job nor repeats it. Every tick is wrapped in
 * `skipWhileRunning`, so a slow round is never run alongside the next one.
 */

import { logger } from "@secondlayer/shared";
import type postgres from "postgres";
import type { BackupConfig } from "./backups.ts";
import {
	type TenantRow,
	acct8For,
	listTenantsDueBackup,
	listTenantsDueStorageSample,
	listTenantsWithStaleBackup,
	markBackedUp,
	markStorageSampled,
	utcDay,
} from "./control-db.ts";
import {
	DEFAULT_PENDING_CAP,
	type MemoryAccumulator,
	type MeterBatchItem,
	logDroppedMeters,
	mergePending,
	sampleMemoryGbHour,
	sampleStorageGbDay,
} from "./meters.ts";
import { skipWhileRunning } from "./tick-guard.ts";

/** How often the daily jobs check whether they are due. */
export const DAILY_JOB_TICK_MS = 10 * 60_000;
/** A backup older than this is an incident: nightly plus two hours of slack. */
export const BACKUP_STALE_MS = 26 * 60 * 60_000;
const BACKUP_STALE_ALERT_EVERY_MS = 60 * 60_000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Nominal gap between memory samples, used for a tenant's first sample. */
export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
/** Longest span one memory sample is charged for, so a stalled process never
 *  bills a tenant for the whole outage. */
export const MEMORY_SAMPLE_CAP_MS = 5 * 60_000;

/** Samples every running tenant's memory and adds the GB-hours for the time
 *  since THAT tenant's previous sample (capped), not a fixed interval: a late
 *  or slow tick charges what actually elapsed. `onRunning` gets the running
 *  tenant ids each tick (the meter socket sync). */
export function createMemorySampleTick(deps: {
	listRunning: () => Promise<TenantRow[]>;
	sampleBytes: (accountId: string) => Promise<number>;
	accumulator: MemoryAccumulator;
	onRunning?: (accountIds: string[]) => void;
	now?: () => Date;
	onSkip?: () => void;
}): () => Promise<void> {
	const now = deps.now ?? (() => new Date());
	const lastSampleAt = new Map<string, number>();

	return skipWhileRunning(async () => {
		let running: TenantRow[];
		try {
			running = await deps.listRunning();
		} catch (err) {
			logger.error("workload.meters.memory_sample_list_failed", {
				error: errorMessage(err),
			});
			return;
		}
		deps.onRunning?.(running.map((tenant) => tenant.account_id));
		const runningIds = new Set(running.map((tenant) => tenant.account_id));
		for (const accountId of lastSampleAt.keys()) {
			if (!runningIds.has(accountId)) lastSampleAt.delete(accountId);
		}
		for (const tenant of running) {
			const at = now().getTime();
			const previous = lastSampleAt.get(tenant.account_id);
			const elapsedMs =
				previous === undefined
					? MEMORY_SAMPLE_INTERVAL_MS
					: Math.min(Math.max(at - previous, 0), MEMORY_SAMPLE_CAP_MS);
			try {
				const item = await sampleMemoryGbHour(
					tenant.account_id,
					deps.sampleBytes,
					elapsedMs / 1000,
					tenant.has_subgraphs,
				);
				lastSampleAt.set(tenant.account_id, at);
				deps.accumulator.add(
					tenant.account_id,
					item.quantity,
					item.observedQuantity,
				);
			} catch (err) {
				logger.error("workload.meters.memory_sample_failed", {
					accountId: tenant.account_id,
					error: errorMessage(err),
				});
			}
		}
	}, deps.onSkip);
}

export interface StorageSampleTick {
	tick: () => Promise<void>;
	/** Samples that have not reached the platform yet (for the shutdown flush). */
	pending: () => MeterBatchItem[];
}

/** Samples every running tenant that has no sample for today's UTC day, flushes
 *  it, and records the day only once the platform accepted the row. A failed
 *  flush leaves the tenant due, so the next tick samples and sends it again
 *  under the same idempotency key. */
export function createStorageSampleTick(deps: {
	db: postgres.Sql;
	sampleBytes: (accountId: string) => Promise<number>;
	flush: (items: MeterBatchItem[]) => Promise<MeterBatchItem[]>;
	now?: () => Date;
	onSkip?: () => void;
}): StorageSampleTick {
	const now = deps.now ?? (() => new Date());
	let pending: MeterBatchItem[] = [];

	const tick = skipWhileRunning(async () => {
		const at = now();
		let due: TenantRow[] = [];
		try {
			due = await listTenantsDueStorageSample(deps.db, at);
		} catch (err) {
			logger.error("workload.meters.storage_sample_list_failed", {
				error: errorMessage(err),
			});
		}
		const fresh: MeterBatchItem[] = [];
		for (const tenant of due) {
			try {
				fresh.push(
					await sampleStorageGbDay(tenant.account_id, deps.sampleBytes),
				);
			} catch (err) {
				logger.error("workload.meters.storage_sample_failed", {
					accountId: tenant.account_id,
					error: errorMessage(err),
				});
			}
		}
		const merged = mergePending(pending, fresh, DEFAULT_PENDING_CAP);
		logDroppedMeters("pending_overflow:storage", merged.dropped);
		pending = await deps.flush(merged.items);

		const unsent = new Set(pending.map((item) => item.idempotencyKey));
		for (const item of fresh) {
			if (unsent.has(item.idempotencyKey)) continue;
			await markStorageSampled(deps.db, item.accountId, at).catch((err) => {
				logger.error("workload.meters.storage_mark_failed", {
					accountId: item.accountId,
					error: errorMessage(err),
				});
			});
		}
	}, deps.onSkip);

	return { tick, pending: () => pending };
}

/** Dumps every running or stopped tenant whose last dump predates today's UTC
 *  day, one at a time, recording each success. One tenant's failure never
 *  skips the rest. After the pass: the 30-day sweep of destroy-time dumps
 *  (once per process-day), and an alert for any tenant with no dump inside
 *  `BACKUP_STALE_MS` (at most hourly). */
export function createBackupTick(deps: {
	db: postgres.Sql;
	backups: BackupConfig;
	backup: (config: BackupConfig, acct8: string) => Promise<unknown>;
	pruneFinal: (config: BackupConfig) => Promise<unknown>;
	now?: () => Date;
	onStale?: (stale: TenantRow[]) => void;
	onSkip?: () => void;
}): () => Promise<void> {
	const now = deps.now ?? (() => new Date());
	const onStale =
		deps.onStale ??
		((stale) =>
			logger.error("workload.backup.stale", {
				staleMs: BACKUP_STALE_MS,
				accounts: stale.map((t) => t.account_id),
			}));
	let lastPruneDay: string | null = null;
	let lastAlertAt = 0;

	return skipWhileRunning(async () => {
		const at = now();
		let due: TenantRow[] = [];
		try {
			due = await listTenantsDueBackup(deps.db, at);
		} catch (err) {
			logger.error("workload.backup.list_failed", { error: errorMessage(err) });
		}
		for (const tenant of due) {
			try {
				await deps.backup(deps.backups, acct8For(tenant.account_id));
				await markBackedUp(deps.db, tenant.account_id, now());
			} catch (err) {
				logger.error("workload.backup.failed", {
					accountId: tenant.account_id,
					error: errorMessage(err),
				});
			}
		}

		if (lastPruneDay !== utcDay(at)) {
			try {
				await deps.pruneFinal(deps.backups);
				lastPruneDay = utcDay(at);
			} catch (err) {
				logger.error("workload.backup.prune_final_failed", {
					error: errorMessage(err),
				});
			}
		}

		if (at.getTime() - lastAlertAt >= BACKUP_STALE_ALERT_EVERY_MS) {
			try {
				const stale = await listTenantsWithStaleBackup(
					deps.db,
					at,
					BACKUP_STALE_MS,
				);
				if (stale.length > 0) {
					lastAlertAt = at.getTime();
					onStale(stale);
				}
			} catch (err) {
				logger.error("workload.backup.stale_check_failed", {
					error: errorMessage(err),
				});
			}
		}
	}, deps.onSkip);
}
