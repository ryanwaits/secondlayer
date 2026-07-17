import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../../chains/definitions.ts";
import { createWalletClient } from "../../../clients/createWalletClient.ts";
import type { Client } from "../../../clients/types.ts";
import { BroadcastError } from "../../../errors/transaction.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import { signTransactionWithAccount } from "../../../transactions/signer.ts";
import { deserializeTransaction } from "../../../transactions/wire/deserialize.ts";
import { custom } from "../../../transports/custom.ts";
import { hexToBytes } from "../../../utils/encoding.ts";
import {
	type NonceManagerSource,
	broadcastWithNonceReset,
	createNonceManager,
	isNonceConflictError,
	resolveNonce,
	startNonceReconciler,
} from "../nonceManager.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

/** Source that returns a fixed floor and counts how often it was read. */
function countingSource(floor: bigint) {
	const state = { reads: 0 };
	const source: NonceManagerSource = {
		get: async () => {
			state.reads++;
			return floor;
		},
	};
	return { source, state };
}

describe("createNonceManager", () => {
	const fakeClient = { chain: mainnet } as unknown as Client;
	const addr = ACCOUNT.address;

	it("sequential consume increments from the source floor", async () => {
		const { source } = countingSource(5n);
		const manager = createNonceManager({ source });

		const nonces: bigint[] = [];
		for (let i = 0; i < 5; i++) {
			nonces.push(await manager.consume({ client: fakeClient, address: addr }));
		}

		expect(nonces).toEqual([5n, 6n, 7n, 8n, 9n]);
	});

	it("reads the floor only once across many consumes", async () => {
		const { source, state } = countingSource(5n);
		const manager = createNonceManager({ source });

		for (let i = 0; i < 4; i++) {
			await manager.consume({ client: fakeClient, address: addr });
		}

		expect(state.reads).toBe(1);
	});

	it("serializes concurrent consume into unique, strictly increasing nonces", async () => {
		const { source } = countingSource(100n);
		const manager = createNonceManager({ source });

		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				manager.consume({ client: fakeClient, address: addr }),
			),
		);

		const sorted = [...results].sort((a, b) => Number(a - b));
		expect(sorted).toEqual([
			100n,
			101n,
			102n,
			103n,
			104n,
			105n,
			106n,
			107n,
			108n,
			109n,
		]);
		expect(new Set(results).size).toBe(10);
	});

	it("keys nonces per address — separate addresses do not collide", async () => {
		const { source } = countingSource(5n);
		const manager = createNonceManager({ source });

		const a = await manager.consume({ client: fakeClient, address: "SP_A" });
		const b = await manager.consume({ client: fakeClient, address: "SP_B" });

		expect(a).toBe(5n);
		expect(b).toBe(5n);
	});

	it("reset re-syncs the floor from the source", async () => {
		let floor = 5n;
		const source: NonceManagerSource = { get: async () => floor };
		const manager = createNonceManager({ source });

		expect(await manager.consume({ client: fakeClient, address: addr })).toBe(
			5n,
		);
		expect(await manager.consume({ client: fakeClient, address: addr })).toBe(
			6n,
		);

		// Chain advanced (earlier txs mined) — without reset we keep our local count.
		floor = 10n;
		expect(await manager.consume({ client: fakeClient, address: addr })).toBe(
			7n,
		);

		manager.reset({ client: fakeClient, address: addr });
		expect(await manager.consume({ client: fakeClient, address: addr })).toBe(
			10n,
		);
	});
});

describe("isNonceConflictError", () => {
	it("detects ConflictingNonceInMempool", () => {
		const err = new BroadcastError("rejected", {
			reason: "ConflictingNonceInMempool",
		});
		expect(isNonceConflictError(err)).toBe(true);
	});

	it("detects BadNonce", () => {
		expect(isNonceConflictError(new BroadcastError("BadNonce"))).toBe(true);
	});

	it("ignores unrelated broadcast errors and non-errors", () => {
		expect(isNonceConflictError(new BroadcastError("NotEnoughFunds"))).toBe(
			false,
		);
		expect(isNonceConflictError(new Error("ConflictingNonceInMempool"))).toBe(
			false,
		);
		expect(isNonceConflictError("nonce")).toBe(false);
	});
});

describe("resolveNonce", () => {
	it("uses the nonce manager when present", async () => {
		const client = {
			chain: mainnet,
			nonceManager: createNonceManager({ source: { get: async () => 42n } }),
		} as unknown as Client;

		expect(await resolveNonce(client, ACCOUNT.address)).toBe(42n);
	});

	it("falls back to a confirmed /v2/accounts read without a manager", async () => {
		const client = {
			request: async (path: string) => {
				expect(path).toContain("/v2/accounts/");
				return { nonce: 7 };
			},
		} as unknown as Client;

		expect(await resolveNonce(client, ACCOUNT.address)).toBe(7n);
	});
});

describe("broadcastWithNonceReset", () => {
	it("resets the manager on a nonce-conflict rejection", async () => {
		const signed = await signTransactionWithAccount(
			buildTokenTransfer({
				recipient: ACCOUNT.address,
				amount: 1000n,
				fee: 200n,
				nonce: 0n,
				publicKey: ACCOUNT.publicKey,
				chain: mainnet,
			}),
			ACCOUNT,
		);

		const resets: string[] = [];
		const client = {
			chain: mainnet,
			nonceManager: {
				consume: async () => 0n,
				reset: ({ address }: { address: string }) => {
					resets.push(address);
				},
			},
			request: async () => ({
				error: "transaction rejected",
				reason: "ConflictingNonceInMempool",
			}),
		} as unknown as Client;

		await expect(
			broadcastWithNonceReset(client, {
				transaction: signed,
				address: "SPSENDER",
			}),
		).rejects.toBeInstanceOf(BroadcastError);

		expect(resets).toEqual(["SPSENDER"]);
	});
});

describe("wallet client integration", () => {
	it("builds back-to-back transfers with sequential nonces n, n+1, n+2", async () => {
		const broadcastNonces: bigint[] = [];
		const txid = `0x${"ab".repeat(32)}`;

		const request = async (
			path: string,
			// biome-ignore lint/suspicious/noExplicitAny: test transport stub
			options?: any,
		) => {
			if (path.includes("/v2/accounts/")) return { nonce: 9 };
			if (path.includes("/v2/transactions")) {
				const tx = deserializeTransaction(hexToBytes(options.body.tx));
				// biome-ignore lint/suspicious/noExplicitAny: spending condition shape
				broadcastNonces.push((tx.auth.spendingCondition as any).nonce);
				return txid;
			}
			throw new Error(`unexpected path ${path}`);
		};

		const client = createWalletClient({
			chain: mainnet,
			account: ACCOUNT,
			transport: custom({ request }),
			nonceManager: createNonceManager(),
		});

		for (let i = 0; i < 3; i++) {
			const result = await client.transferStx({
				to: ACCOUNT.address,
				amount: 1000n,
				fee: 200n, // explicit fee skips the estimate round-trip
			});
			expect(result).toBe(txid);
		}

		expect(broadcastNonces).toEqual([9n, 10n, 11n]);
	});
});

describe("startNonceReconciler", () => {
	it("contains a throwing onError callback", async () => {
		const client = { chain: mainnet } as unknown as Client;

		// manager.peek() must return a tracked nonce so reconcileNonce reaches the
		// source read; but we make the SOURCE throw to force the catch → onError.
		const manager = createNonceManager({ source: { get: async () => 1n } });

		let onErrorCalls = 0;
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
			addresses: [ACCOUNT.address],
			// THIS is what throws — reconcileNonce awaits source.get first.
			source: {
				get: async () => {
					throw new Error("source down");
				},
			},
			intervalMs: 5,
			onError: () => {
				onErrorCalls++;
				throw new Error("callback boom"); // must NOT crash the loop / leak a rejection
			},
			clock,
		});

		// Advance the test clock — ticks fire deterministically, no real timers.
		// If the throwing onError leaked as an unhandled rejection, bun:test fails
		// the run. We also assert the branch actually ran.
		await clock.advance(30);
		handle.stop();
		expect(onErrorCalls).toBeGreaterThan(0);
	});
});
