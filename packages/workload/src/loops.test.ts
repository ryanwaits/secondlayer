import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { BackupConfig } from "./backups.ts";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
} from "./control-db.ts";
import {
	BACKUP_STALE_MS,
	createBackupTick,
	createStorageSampleTick,
} from "./loops.ts";
import type { MeterBatchItem } from "./meters.ts";
import { forceTenantState } from "./tenant-fixture.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

const backups = {} as BackupConfig;

async function runningTenant(): Promise<string> {
	const accountId = crypto.randomUUID();
	await insertProvisioningTenant(db, accountId, acct8For(accountId));
	await forceTenantState(db, accountId, "running");
	return accountId;
}

beforeAll(async () => {
	if (HAS_DB) await ensureControlSchema(db);
});
afterAll(async () => {
	if (HAS_DB) await db.end();
});

describe.skipIf(!HAS_DB)("storage sample tick", () => {
	function harness(accountId: string, now: () => Date, failFlush = false) {
		const sampled: string[] = [];
		const flushed: MeterBatchItem[] = [];
		const storage = createStorageSampleTick({
			db,
			now,
			sampleBytes: async (id) => {
				sampled.push(id);
				return 1024 ** 3;
			},
			flush: async (items) => {
				const mine = items.filter((i) => i.accountId === accountId);
				if (failFlush) return mine;
				flushed.push(...mine);
				return [];
			},
		});
		return {
			storage,
			flushed,
			count: () => sampled.filter((id) => id === accountId).length,
		};
	}

	test("a restart on the same day does not sample the tenant again", async () => {
		const accountId = await runningTenant();
		try {
			const day = () => new Date("2026-11-07T03:00:00Z");
			const first = harness(accountId, day);
			await first.storage.tick();
			expect(first.count()).toBe(1);
			expect(first.flushed).toHaveLength(1);

			// A fresh process: new tick closure, same control DB.
			const afterRestart = harness(
				accountId,
				() => new Date("2026-11-07T21:00:00Z"),
			);
			await afterRestart.storage.tick();
			expect(afterRestart.count()).toBe(0);
			expect(afterRestart.flushed).toHaveLength(0);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a restart after midnight UTC samples the tenant for the new day", async () => {
		const accountId = await runningTenant();
		try {
			const dayOne = harness(accountId, () => new Date("2026-11-07T23:55:00Z"));
			await dayOne.storage.tick();
			expect(dayOne.count()).toBe(1);

			const dayTwo = harness(accountId, () => new Date("2026-11-08T00:05:00Z"));
			await dayTwo.storage.tick();
			expect(dayTwo.count()).toBe(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a day whose flush failed is sampled again on the next tick", async () => {
		const accountId = await runningTenant();
		try {
			const now = () => new Date("2026-11-07T03:00:00Z");
			const down = harness(accountId, now, true);
			await down.storage.tick();
			expect(
				(await getTenant(db, accountId))?.last_storage_sample_day,
			).toBeNull();
			expect(down.storage.pending()).toHaveLength(1);

			const up = harness(accountId, now);
			await up.storage.tick();
			expect(up.count()).toBe(1);
			expect(up.flushed).toHaveLength(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a stopped tenant is not sampled", async () => {
		const accountId = await runningTenant();
		await forceTenantState(db, accountId, "stopped");
		try {
			const h = harness(accountId, () => new Date("2026-11-07T03:00:00Z"));
			await h.storage.tick();
			expect(h.count()).toBe(0);
		} finally {
			await deleteTenant(db, accountId);
		}
	});
});

describe.skipIf(!HAS_DB)("backup tick", () => {
	function harness(
		accountId: string,
		now: () => Date,
		opts: { fail?: boolean; onStale?: (ids: string[]) => void } = {},
	) {
		const dumped: string[] = [];
		const tick = createBackupTick({
			db,
			backups,
			now,
			backup: async (_cfg, acct8) => {
				if (acct8 === acct8For(accountId)) {
					if (opts.fail) throw new Error("dump failed");
					dumped.push(acct8);
				}
			},
			pruneFinal: async () => {},
			onStale: (stale) => opts.onStale?.(stale.map((t) => t.account_id)),
		});
		return { tick, dumped };
	}

	test("a restart on the same day does not dump the tenant again, the next day does", async () => {
		const accountId = await runningTenant();
		try {
			const first = harness(accountId, () => new Date("2026-11-07T02:00:00Z"));
			await first.tick();
			expect(first.dumped).toHaveLength(1);

			const sameDay = harness(
				accountId,
				() => new Date("2026-11-07T20:00:00Z"),
			);
			await sameDay.tick();
			expect(sameDay.dumped).toHaveLength(0);

			const nextDay = harness(
				accountId,
				() => new Date("2026-11-08T02:00:00Z"),
			);
			await nextDay.tick();
			expect(nextDay.dumped).toHaveLength(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a stopped tenant is dumped too", async () => {
		const accountId = await runningTenant();
		await forceTenantState(db, accountId, "stopped");
		try {
			const h = harness(accountId, () => new Date("2026-11-07T02:00:00Z"));
			await h.tick();
			expect(h.dumped).toHaveLength(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a failed dump is not recorded and is retried on the next tick", async () => {
		const accountId = await runningTenant();
		try {
			const now = () => new Date("2026-11-07T02:00:00Z");
			await harness(accountId, now, { fail: true }).tick();
			expect((await getTenant(db, accountId))?.last_backup_at).toBeNull();

			const retry = harness(accountId, now);
			await retry.tick();
			expect(retry.dumped).toHaveLength(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a tenant with no dump for over 26 hours raises the stale alert", async () => {
		const accountId = await runningTenant();
		try {
			const created = (await getTenant(db, accountId))?.created_at as Date;
			const later = () =>
				new Date(created.getTime() + BACKUP_STALE_MS + 60_000);
			const alerted: string[][] = [];
			await harness(accountId, later, {
				fail: true,
				onStale: (ids) => alerted.push(ids),
			}).tick();
			expect(alerted.flat()).toContain(accountId);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("a tenant dumped within 26 hours does not raise the stale alert", async () => {
		const accountId = await runningTenant();
		try {
			const now = () => new Date();
			const alerted: string[][] = [];
			await harness(accountId, now, {
				onStale: (ids) => alerted.push(ids),
			}).tick();
			expect(alerted.flat()).not.toContain(accountId);
		} finally {
			await deleteTenant(db, accountId);
		}
	});
});
