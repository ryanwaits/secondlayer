import { describe, expect, test } from "bun:test";
import {
	type LeaderBackend,
	createPostgresLeaderBackend,
	withLeaderLock,
} from "./leader.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const PG_LOCK_KEY = 770_2099; // dedicated test key, distinct from prod's

/** A single shared lock across "instances", simulating one Postgres lock. */
function lockRegistry() {
	const held = new Set<number>();
	function backend(): LeaderBackend {
		let mine: number | null = null;
		return {
			async tryAcquire(key) {
				if (held.has(key)) return false;
				held.add(key);
				mine = key;
				return true;
			},
			async ping() {},
			async close() {
				if (mine !== null) held.delete(mine);
				mine = null;
			},
		};
	}
	return { held, backend };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withLeaderLock", () => {
	test("only one instance acquires the lock and runs work", async () => {
		const { backend } = lockRegistry();
		let aStarted = 0;
		let bStarted = 0;

		const stopA = withLeaderLock(
			1,
			() => {
				aStarted++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		const stopB = withLeaderLock(
			1,
			() => {
				bStarted++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);

		await tick();
		expect(aStarted).toBe(1);
		expect(bStarted).toBe(0);

		await stopA();
		await stopB();
	});

	test("releasing the leader frees the lock for the standby", async () => {
		const { held, backend } = lockRegistry();
		let started = 0;

		const stopA = withLeaderLock(
			1,
			() => {
				started++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		await tick();
		expect(started).toBe(1);
		expect(held.has(1)).toBe(true);

		// Leader releases → lock is free.
		await stopA();
		expect(held.has(1)).toBe(false);

		// A fresh standby can now acquire immediately.
		const stopB = withLeaderLock(
			1,
			() => {
				started++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		await tick();
		expect(started).toBe(2);
		expect(held.has(1)).toBe(true);
		await stopB();
	});
});

describe.skipIf(!HAS_DB)("withLeaderLock (real Postgres advisory lock)", () => {
	test("real backend: second acquirer is blocked until the first releases", async () => {
		let aLeader = false;
		let bLeader = false;

		const stopA = withLeaderLock(
			PG_LOCK_KEY,
			() => {
				aLeader = true;
				return () => {
					aLeader = false;
				};
			},
			{ createBackend: createPostgresLeaderBackend, pollMs: 10_000 },
		);

		// Let A acquire (real round-trip to Postgres).
		await new Promise((r) => setTimeout(r, 200));
		expect(aLeader).toBe(true);

		const stopB = withLeaderLock(
			PG_LOCK_KEY,
			() => {
				bLeader = true;
				return () => {
					bLeader = false;
				};
			},
			{ createBackend: createPostgresLeaderBackend, pollMs: 200 },
		);

		await new Promise((r) => setTimeout(r, 200));
		expect(bLeader).toBe(false); // A holds the lock

		// A releases (closes its connection) → B's poll acquires.
		await stopA();
		await new Promise((r) => setTimeout(r, 600));
		expect(bLeader).toBe(true);

		await stopB();
	});
});
