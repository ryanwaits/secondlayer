/**
 * Embedded migration — advisory-locked before listeners/workers start.
 * Concurrent boots serialize. A failed pass releases the lock and refuses
 * to start the rest of the runtime.
 */

export const MIGRATION_LOCK_KEY = 0x534c4d47; // "SLMG"

export type EmbeddedMigration = {
	applied: string[];
	ok: boolean;
	error: string | null;
};

export type MigrationRunner = {
	acquire: (key: number) => Promise<boolean>;
	release: (key: number) => Promise<void>;
	apply: () => Promise<string[]>;
};

export async function migrateEmbedded(
	runner: MigrationRunner,
): Promise<EmbeddedMigration> {
	const got = await runner.acquire(MIGRATION_LOCK_KEY);
	if (!got) {
		return {
			applied: [],
			ok: false,
			error: "migration lock held by another process",
		};
	}
	try {
		const applied = await runner.apply();
		return { applied, ok: true, error: null };
	} catch (error) {
		return {
			applied: [],
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await runner.release(MIGRATION_LOCK_KEY);
	}
}

/** In-memory lock used by concurrent-startup tests. */
export function createMemoryMigrationRunner(opts?: {
	fail?: boolean;
	delayMs?: number;
	sleep?: (ms: number) => Promise<void>;
}): MigrationRunner & { holders: number; appliedCount: number } {
	let held = false;
	const state = { holders: 0, appliedCount: 0 };
	return {
		get holders() {
			return state.holders;
		},
		get appliedCount() {
			return state.appliedCount;
		},
		async acquire() {
			if (held) return false;
			held = true;
			state.holders += 1;
			return true;
		},
		async release() {
			held = false;
			state.holders = Math.max(0, state.holders - 1);
		},
		async apply() {
			if (opts?.delayMs) await (opts.sleep ?? delay)(opts.delayMs);
			if (opts?.fail) throw new Error("migration failed");
			state.appliedCount += 1;
			return ["0116_coverage_schema"];
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
