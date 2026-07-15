import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../../chains/definitions.ts";
import { serializeCV } from "../../../clarity/serialize.ts";
import { Cl } from "../../../clarity/values.ts";
import { createPublicClient } from "../../../clients/createPublicClient.ts";
import { createWalletClient } from "../../../clients/createWalletClient.ts";
import type { Client } from "../../../clients/types.ts";
import {
	TransactionAbortedError,
	TransactionDroppedError,
	WaitForTransactionTimeoutError,
} from "../../../errors/transaction.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import { signTransactionWithAccount } from "../../../transactions/signer.ts";
import { custom } from "../../../transports/custom.ts";
import { sendTransaction } from "../../wallet/sendTransaction.ts";
import { getTransaction } from "../getTransaction.ts";
import { indexTxSource } from "../txSources.ts";
import { waitForTransactionReceipt } from "../waitForTransactionReceipt.ts";

const TXID = `0x${"ab".repeat(32)}`;
const OK_RESULT_HEX = `0x${serializeCV(Cl.ok(Cl.bool(true)))}`;

const FAST = { pollingInterval: 1, timeout: 2_000, droppedGracePeriod: 50 };

/**
 * Client whose /extended/v1/tx responses are consumed from a queue (last
 * entry repeats). `tipHeights` feeds /v2/info the same way.
 */
function scriptedClient(
	txResponses: unknown[],
	tipHeights: number[] = [100],
): Client {
	let txCalls = 0;
	let tipCalls = 0;
	const request = async (path: string) => {
		if (path.includes("/extended/v1/tx/")) {
			const res = txResponses[Math.min(txCalls, txResponses.length - 1)];
			txCalls++;
			return res;
		}
		if (path.includes("/v2/info")) {
			const tip = tipHeights[Math.min(tipCalls, tipHeights.length - 1)];
			tipCalls++;
			return { stacks_tip_height: tip };
		}
		throw new Error(`unexpected path ${path}`);
	};
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request }),
	}) as unknown as Client;
}

const pending = { tx_status: "pending" };
const success = (blockHeight = 100) => ({
	tx_status: "success",
	block_height: blockHeight,
	block_hash: "0xblock",
	tx_result: { hex: OK_RESULT_HEX, repr: "(ok true)" },
	events: [],
});
const notFound = { error: "could not find transaction" };

describe("waitForTransactionReceipt", () => {
	it("resolves once pending turns into success (N=1)", async () => {
		const client = scriptedClient([pending, pending, success()]);
		const receipt = await waitForTransactionReceipt(client, {
			txid: TXID,
			...FAST,
		});
		expect(receipt.status).toBe("success");
		expect(receipt.blockHeight).toBe(100);
		expect(receipt.result).toEqual(Cl.ok(Cl.bool(true)));
	});

	it("waits for the tip to advance when confirmations > 1", async () => {
		// mined at 100; tip goes 100 → 101 → 102 (3rd confirmation at 102)
		const client = scriptedClient([success(100)], [100, 101, 102]);
		const receipt = await waitForTransactionReceipt(client, {
			txid: TXID,
			confirmations: 3,
			...FAST,
		});
		expect(receipt.blockHeight).toBe(100);
	});

	it("rejects with the receipt attached when the tx aborts", async () => {
		const abort = {
			tx_status: "abort_by_response",
			block_height: 100,
			tx_result: { hex: OK_RESULT_HEX },
			events: [],
		};
		const client = scriptedClient([pending, abort]);
		const err = await waitForTransactionReceipt(client, {
			txid: TXID,
			...FAST,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(TransactionAbortedError);
		expect((err as TransactionAbortedError).receipt).toMatchObject({
			status: "abort_by_response",
			blockHeight: 100,
		});
	});

	it("tolerates not-found within the grace window (propagation lag)", async () => {
		const client = scriptedClient([notFound, notFound, success()]);
		const receipt = await waitForTransactionReceipt(client, {
			txid: TXID,
			...FAST,
		});
		expect(receipt.status).toBe("success");
	});

	it("rejects as dropped after sustained not-found", async () => {
		const client = scriptedClient([pending, notFound]);
		const err = await waitForTransactionReceipt(client, {
			txid: TXID,
			...FAST,
			droppedGracePeriod: 20,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(TransactionDroppedError);
		expect((err as Error).message).toContain("left the mempool");
	});

	it("rejects immediately on an explicit dropped status", async () => {
		const client = scriptedClient([{ tx_status: "dropped_replace_by_fee" }]);
		const err = await waitForTransactionReceipt(client, {
			txid: TXID,
			...FAST,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(TransactionDroppedError);
	});

	it("rejects at timeout while still pending", async () => {
		const client = scriptedClient([pending]);
		const err = await waitForTransactionReceipt(client, {
			txid: TXID,
			pollingInterval: 1,
			timeout: 25,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(WaitForTransactionTimeoutError);
	});

	it("recovers when a reorg moves the tx to a later block", async () => {
		// mined at 100, 1 conf — then reorged to 105, tip catches up to 106
		const client = scriptedClient(
			[success(100), success(105), success(105)],
			[100, 104, 106],
		);
		const receipt = await waitForTransactionReceipt(client, {
			txid: TXID,
			confirmations: 2,
			...FAST,
		});
		expect(receipt.blockHeight).toBe(105);
	});
});

describe("indexTxSource", () => {
	it("confirms with a single response using the embedded tip", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return new Response(
				JSON.stringify({
					transaction: {
						tx_id: TXID,
						block_height: 100,
						status: "success",
						contract_call: { result_hex: OK_RESULT_HEX },
					},
					tip: { block_height: 103 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as typeof fetch;

		// client whose transport must never be hit — tip comes from the source
		const client = scriptedClient([]);
		const receipt = await waitForTransactionReceipt(client, {
			txid: TXID,
			confirmations: 3,
			source: indexTxSource({ baseUrl: "https://idx.test", fetchImpl }),
			...FAST,
		});
		expect(receipt.status).toBe("success");
		expect(receipt.result).toEqual(Cl.ok(Cl.bool(true)));
		expect(calls).toBe(1);
	});

	it("treats 404 as unknown (pending-compatible)", async () => {
		const fetchImpl = (async () =>
			new Response("{}", { status: 404 })) as typeof fetch;
		const source = indexTxSource({ baseUrl: "https://idx.test", fetchImpl });
		const snapshot = await source.get({
			client: scriptedClient([]),
			txid: TXID,
		});
		expect(snapshot.receipt).toBeNull();
	});
});

describe("getTransaction", () => {
	it("returns a normalized receipt", async () => {
		const client = scriptedClient([success()]);
		const receipt = await getTransaction(client, { txid: TXID });
		expect(receipt?.status).toBe("success");
		expect(receipt?.resultHex).toBe(OK_RESULT_HEX);
	});

	it("returns null when unknown", async () => {
		const client = scriptedClient([notFound]);
		expect(await getTransaction(client, { txid: TXID })).toBeNull();
	});
});

describe("sendTransaction wait param", () => {
	it("returns the receipt when wait is set", async () => {
		const account = privateKeyToAccount("11".repeat(32));
		const unsigned = buildTokenTransfer({
			recipient: account.address,
			amount: 1000n,
			fee: 200n,
			nonce: 0n,
			publicKey: account.publicKey,
			chain: mainnet,
		});
		const signed = await signTransactionWithAccount(unsigned, account);

		let broadcasts = 0;
		const request = async (path: string) => {
			if (path.includes("/v2/transactions")) {
				broadcasts++;
				return TXID;
			}
			if (path.includes("/extended/v1/tx/")) return success();
			throw new Error(`unexpected path ${path}`);
		};
		const client = createWalletClient({
			chain: mainnet,
			account,
			transport: custom({ request }),
		}) as unknown as Client;

		const result = await sendTransaction(client, {
			transaction: signed,
			wait: true,
		});
		expect(broadcasts).toBe(1);
		expect(result.txid).toBe(TXID);
		expect(result.receipt?.status).toBe("success");
	});
});
