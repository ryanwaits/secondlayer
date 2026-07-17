import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import {
	type NonceManagerSource,
	createNonceManager,
	reconcileNonce,
	startNonceReconciler,
} from "../nonceManager.ts";
import {
	hiroNonceSource,
	indexSource,
	mempoolAwareSource,
	nextFreeNonce,
} from "../nonceSources.ts";

const client = { chain: { id: 1 } } as unknown as Client;
const ADDR = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";

/** Build a fetch stub returning JSON. `handler` inspects (url, init). */
function fetchStub(
	handler: (
		url: string,
		init?: RequestInit,
	) => { status?: number; body: unknown },
): typeof globalThis.fetch {
	return (async (input: string | URL, init?: RequestInit) => {
		const { status = 200, body } = handler(input.toString(), init);
		return new Response(JSON.stringify(body), { status });
	}) as typeof globalThis.fetch;
}

describe("nextFreeNonce", () => {
	it("returns confirmed when nothing is pending", () => {
		expect(nextFreeNonce(5n, [])).toBe(5n);
	});
	it("skips a contiguous pending chain", () => {
		expect(nextFreeNonce(5n, [5n, 6n])).toBe(7n);
	});
	it("fills a gap instead of stranding (better than possible_next_nonce)", () => {
		expect(nextFreeNonce(5n, [7n])).toBe(5n);
		expect(nextFreeNonce(5n, [5n, 7n])).toBe(6n);
	});
	it("ignores pending below the confirmed floor", () => {
		expect(nextFreeNonce(5n, [3n, 5n])).toBe(6n);
	});
});

describe("mempoolAwareSource", () => {
	it("folds pending into the next nonce", async () => {
		const source = mempoolAwareSource({
			getConfirmed: async () => 5n,
			getPending: async () => [5n, 6n],
		});
		expect(await source.get({ client, address: ADDR })).toBe(7n);
	});

	it("degrades to the confirmed floor when getPending throws", async () => {
		const source = mempoolAwareSource({
			getConfirmed: async () => 5n,
			getPending: async () => {
				throw new Error("index down");
			},
		});
		expect(await source.get({ client, address: ADDR })).toBe(5n);
	});

	it("defaults the confirmed floor to the node /v2/accounts read", async () => {
		const nodeClient = {
			chain: { id: 1 },
			request: async (path: string) => {
				expect(path).toContain("/v2/accounts/");
				return { nonce: 9 };
			},
		} as unknown as Client;
		const source = mempoolAwareSource({ getPending: async () => [] });
		expect(await source.get({ client: nodeClient, address: ADDR })).toBe(9n);
	});
});

describe("indexSource", () => {
	it("computes the next nonce from /v1/index/mempool pending txs", async () => {
		const fetchImpl = fetchStub((url) => {
			expect(url).toContain("/v1/index/mempool");
			expect(url).toContain(`sender=${ADDR}`);
			return {
				body: { mempool: [{ nonce: "5" }, { nonce: "6" }], next_cursor: null },
			};
		});
		const source = indexSource({ getConfirmed: async () => 5n, fetchImpl });
		expect(await source.get({ client, address: ADDR })).toBe(7n);
	});

	it("pages through the mempool until next_cursor is null", async () => {
		const fetchImpl = fetchStub((url) => {
			if (url.includes("from_cursor=c1")) {
				return { body: { mempool: [{ nonce: "6" }], next_cursor: null } };
			}
			return { body: { mempool: [{ nonce: "5" }], next_cursor: "c1" } };
		});
		const source = indexSource({ getConfirmed: async () => 5n, fetchImpl });
		expect(await source.get({ client, address: ADDR })).toBe(7n);
	});

	it("sends the api key when provided", async () => {
		let seenAuth: string | undefined;
		const fetchImpl = fetchStub((_url, init) => {
			seenAuth = (init?.headers as Record<string, string>)?.authorization;
			return { body: { mempool: [], next_cursor: null } };
		});
		const source = indexSource({
			getConfirmed: async () => 5n,
			apiKey: "secret",
			fetchImpl,
		});
		await source.get({ client, address: ADDR });
		expect(seenAuth).toBe("Bearer secret");
	});

	it("degrades to the confirmed floor on a non-ok response", async () => {
		const fetchImpl = fetchStub(() => ({ status: 500, body: {} }));
		const source = indexSource({ getConfirmed: async () => 5n, fetchImpl });
		expect(await source.get({ client, address: ADDR })).toBe(5n);
	});
});

describe("hiroNonceSource", () => {
	it("returns possible_next_nonce when there are no gaps", async () => {
		const fetchImpl = fetchStub((url) => {
			expect(url).toContain(`/extended/v1/address/${ADDR}/nonces`);
			return { body: { possible_next_nonce: 9, detected_missing_nonces: [] } };
		});
		const source = hiroNonceSource({
			baseUrl: "https://api.hiro.so",
			fetchImpl,
		});
		expect(await source.get({ client, address: ADDR })).toBe(9n);
	});

	it("fills the lowest detected gap first", async () => {
		const fetchImpl = fetchStub(() => ({
			body: { possible_next_nonce: 9, detected_missing_nonces: [7, 6] },
		}));
		const source = hiroNonceSource({
			baseUrl: "https://api.hiro.so",
			fetchImpl,
		});
		expect(await source.get({ client, address: ADDR })).toBe(6n);
	});
});

describe("reconcileNonce", () => {
	function setup(initial: bigint) {
		const state = { next: initial };
		const source: NonceManagerSource = { get: async () => state.next };
		const manager = createNonceManager({ source });
		return { state, source, manager };
	}

	it("resets upward when the chain advanced past the local view", async () => {
		const { state, source, manager } = setup(5n);
		await manager.consume({ client, address: ADDR }); // 5
		await manager.consume({ client, address: ADDR }); // 6 (tracked next = 7)

		state.next = 10n;
		const r = await reconcileNonce(manager, { client, address: ADDR, source });
		expect(r).toMatchObject({ reset: true, authoritative: 10n, tracked: 7n });
		expect(await manager.consume({ client, address: ADDR })).toBe(10n);
	});

	it("resets downward to reuse a dropped-tx nonce", async () => {
		const { state, source, manager } = setup(5n);
		await manager.consume({ client, address: ADDR }); // 5
		await manager.consume({ client, address: ADDR }); // 6 (tracked next = 7)

		state.next = 6n; // a pending tx was dropped → slot 6 is free again
		const r = await reconcileNonce(manager, { client, address: ADDR, source });
		expect(r.reset).toBe(true);
		expect(await manager.consume({ client, address: ADDR })).toBe(6n);
	});

	it("does not reset downward when downward:false", async () => {
		const { state, source, manager } = setup(5n);
		await manager.consume({ client, address: ADDR }); // 5
		await manager.consume({ client, address: ADDR }); // 6

		state.next = 6n;
		const r = await reconcileNonce(manager, {
			client,
			address: ADDR,
			source,
			downward: false,
		});
		expect(r.reset).toBe(false);
		expect(await manager.consume({ client, address: ADDR })).toBe(7n);
	});

	it("is a no-op when tracked equals authoritative", async () => {
		const { source, manager } = setup(5n);
		await manager.consume({ client, address: ADDR }); // 5 (tracked next = 6)
		const r = await reconcileNonce(manager, {
			client,
			address: ADDR,
			source: { get: async () => 6n },
		});
		expect(r.reset).toBe(false);
		void source;
	});

	it("is a no-op when the address is untracked", async () => {
		const { source, manager } = setup(5n);
		const r = await reconcileNonce(manager, { client, address: ADDR, source });
		expect(r).toEqual({ reset: false, authoritative: 5n, tracked: undefined });
	});
});

describe("startNonceReconciler", () => {
	it("reconciles tracked addresses on an interval until stopped", async () => {
		const state = { next: 5n };
		const source: NonceManagerSource = { get: async () => state.next };
		const manager = createNonceManager({ source });
		await manager.consume({ client, address: ADDR }); // 5
		await manager.consume({ client, address: ADDR }); // 6 (tracked next = 7)

		state.next = 10n;
		const results: boolean[] = [];
		let clockMs = 0;
		const clock = {
			advance: async (ms: number) => {
				clockMs += ms;
				await new Promise((r) => setTimeout(r, 0)); // yield for async cleanup
			},
			now: () => clockMs,
		};
		const handle = startNonceReconciler(manager, {
			client,
			addresses: [ADDR],
			source,
			intervalMs: 5,
			onReconcile: (_addr, r) => results.push(r.reset),
			clock,
		});

		await clock.advance(30);
		handle.stop();

		expect(results.some((reset) => reset)).toBe(true);
		expect(await manager.consume({ client, address: ADDR })).toBe(10n);
	});
});
