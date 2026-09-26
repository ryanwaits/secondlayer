// Unit tests for `RpcWaitNotifier` against a fake RPC (no real bitcoind, no
// Docker — see `test/regtest/run.ts` for the real-node wake-up proof). The
// injected `sleep` records requested durations without actually waiting, so
// backoff/poll assertions run instantly.
import { describe, expect, test } from "bun:test";
import { RpcWaitNotifier } from "./rpc-wait-notifier.ts";
import { BitcoinRpcError } from "./rpc.ts";

class FakeRpc {
	waitCalls = 0;
	bestHashCalls = 0;
	private waitQueue: Array<() => Promise<{ hash: string; height: number }>> =
		[];
	private bestHashQueue: Array<() => Promise<string>> = [];

	queueWait(result: { hash: string; height: number }): void {
		this.waitQueue.push(async () => result);
	}
	queueWaitError(error: Error): void {
		this.waitQueue.push(async () => {
			throw error;
		});
	}
	queueBestHash(hash: string): void {
		this.bestHashQueue.push(async () => hash);
	}
	queueBestHashError(error: Error): void {
		this.bestHashQueue.push(async () => {
			throw error;
		});
	}

	async waitfornewblock(): Promise<{ hash: string; height: number }> {
		this.waitCalls += 1;
		const next = this.waitQueue.shift();
		if (!next) throw new Error("FakeRpc: no waitfornewblock queued");
		return next();
	}
	async getbestblockhash(): Promise<string> {
		this.bestHashCalls += 1;
		const next = this.bestHashQueue.shift();
		if (!next) throw new Error("FakeRpc: no getbestblockhash queued");
		return next();
	}
}

function recordingSleep(): {
	sleep: (ms: number) => Promise<void>;
	calls: number[];
} {
	const calls: number[] = [];
	return { sleep: async (ms: number) => void calls.push(ms), calls };
}

describe("RpcWaitNotifier", () => {
	test("resolves when waitfornewblock returns a new block", async () => {
		const rpc = new FakeRpc();
		rpc.queueWait({ hash: "block-1", height: 1 });
		const notifier = new RpcWaitNotifier({ rpc });

		await notifier.notified();

		expect(rpc.waitCalls).toBe(1);
	});

	test("resolves when waitfornewblock returns on its own timeout (no new block)", async () => {
		const rpc = new FakeRpc();
		// Bitcoin Core returns the same shape whether a block landed or the
		// timeout elapsed — RpcWaitNotifier treats both as "check again".
		rpc.queueWait({ hash: "same-tip", height: 0 });
		const notifier = new RpcWaitNotifier({ rpc });

		await notifier.notified();

		expect(rpc.waitCalls).toBe(1);
	});

	test("on a network/RPC error, backs off then resolves instead of rejecting", async () => {
		const rpc = new FakeRpc();
		rpc.queueWaitError(new Error("network unreachable"));
		const { sleep, calls } = recordingSleep();
		const notifier = new RpcWaitNotifier({ rpc, sleep });

		await expect(notifier.notified()).resolves.toBeUndefined();

		expect(calls).toEqual([1_000]);
	});

	test("backoff grows on repeated errors, capped at 30s", async () => {
		const rpc = new FakeRpc();
		rpc.queueWaitError(new Error("fail 1"));
		rpc.queueWaitError(new Error("fail 2"));
		rpc.queueWaitError(new Error("fail 3"));
		const { sleep, calls } = recordingSleep();
		const notifier = new RpcWaitNotifier({ rpc, sleep });

		await notifier.notified();
		await notifier.notified();
		await notifier.notified();

		expect(calls).toEqual([1_000, 2_000, 4_000]);
	});

	test("-32601 switches permanently to getbestblockhash polling, resolving when the hash changes", async () => {
		const rpc = new FakeRpc();
		rpc.queueWaitError(new BitcoinRpcError("Method not found", -32601));
		rpc.queueBestHash("hash-a"); // baseline read
		rpc.queueBestHash("hash-a"); // unchanged — keep polling
		rpc.queueBestHash("hash-b"); // changed — resolve
		const { sleep } = recordingSleep();
		const notifier = new RpcWaitNotifier({ rpc, sleep, pollMs: 5_000 });

		await notifier.notified();

		expect(rpc.waitCalls).toBe(1);
		expect(rpc.bestHashCalls).toBe(3);

		// Second call never touches waitfornewblock again — fallback is permanent.
		rpc.queueBestHash("hash-c");
		await notifier.notified();

		expect(rpc.waitCalls).toBe(1);
		expect(rpc.bestHashCalls).toBe(4);
	});

	test("close() makes the next notified() resolve immediately", async () => {
		const rpc = new FakeRpc();
		const notifier = new RpcWaitNotifier({ rpc });

		notifier.close();
		await notifier.notified();

		expect(rpc.waitCalls).toBe(0);
	});
});
