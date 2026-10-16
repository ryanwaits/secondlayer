import { describe, expect, test } from "bun:test";
import type { TenantRow } from "./control-db.ts";
import { TenantCache } from "./tenant-cache.ts";

const ROW = { account_id: "a", state: "running", api_port: 4100 } as TenantRow;

function setup(opts?: {
	row?: TenantRow | undefined;
	readToken?: () => string;
}) {
	const state = { clock: 0, loads: 0, reads: 0 };
	const row = opts && "row" in opts ? opts.row : ROW;
	const cache = new TenantCache({
		now: () => state.clock,
		ttlMs: 5_000,
		load: async () => {
			state.loads++;
			return row;
		},
		readToken:
			opts?.readToken ??
			(() => {
				state.reads++;
				return "tok";
			}),
	});
	return { cache, state };
}

describe("TenantCache", () => {
	test("a hit within the TTL does not reload", async () => {
		const { cache, state } = setup();
		await cache.row("a");
		state.clock += 4_000;
		await cache.row("a");
		expect(state.loads).toBe(1);
	});

	test("a call after the TTL reloads", async () => {
		const { cache, state } = setup();
		await cache.row("a");
		state.clock += 5_001;
		await cache.row("a");
		expect(state.loads).toBe(2);
	});

	test("invalidate forces a row reload and a token re-read", async () => {
		const { cache, state } = setup();
		await cache.row("a");
		cache.token("a");
		cache.token("a");
		expect(state.reads).toBe(1);

		cache.invalidate("a");
		await cache.row("a");
		cache.token("a");
		expect(state.loads).toBe(2);
		expect(state.reads).toBe(2);
	});

	test("concurrent row calls coalesce into one load", async () => {
		const { cache, state } = setup();
		await Promise.all([cache.row("a"), cache.row("a"), cache.row("a")]);
		expect(state.loads).toBe(1);
	});

	test("a missing tenant is re-checked after the short TTL", async () => {
		const { cache, state } = setup({ row: undefined });
		expect(await cache.row("a")).toBeUndefined();
		state.clock += 500;
		await cache.row("a");
		expect(state.loads).toBe(1);

		state.clock += 600; // 1.1s, past the missing TTL but inside the row TTL
		await cache.row("a");
		expect(state.loads).toBe(2);
	});

	test("a token read error propagates and is not cached", () => {
		let attempts = 0;
		const { cache } = setup({
			readToken: () => {
				attempts++;
				if (attempts === 1) throw new Error("no INSTANCE_TOKEN");
				return "tok";
			},
		});
		expect(() => cache.token("a")).toThrow("no INSTANCE_TOKEN");
		expect(cache.token("a")).toBe("tok");
		expect(attempts).toBe(2);
	});

	test("a load that started before invalidate is not cached", async () => {
		let release: (() => void) | undefined;
		let loads = 0;
		const cache = new TenantCache({
			load: async () => {
				loads++;
				if (loads === 1)
					await new Promise<void>((r) => {
						release = r;
					});
				return ROW;
			},
			readToken: () => "tok",
		});
		const first = cache.row("a");
		cache.invalidate("a");
		release?.();
		await first;
		await cache.row("a");
		expect(loads).toBe(2);
	});
});
