import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../../chains/definitions.ts";
import { createWalletClient } from "../../../clients/createWalletClient.ts";
import type { Client } from "../../../clients/types.ts";
import { HttpRequestError } from "../../../errors/http.ts";
import { BroadcastError } from "../../../errors/transaction.ts";
import { TimeoutError } from "../../../errors/transport.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import { getTransactionId } from "../../../transactions/signer.ts";
import { signTransactionWithAccount } from "../../../transactions/signer.ts";
import { deserializeTransaction } from "../../../transactions/wire/deserialize.ts";
import { custom } from "../../../transports/custom.ts";
import { hexToBytes } from "../../../utils/encoding.ts";
import { getContract } from "../../getContract.ts";
import { callContract } from "../callContract.ts";
import { createNonceManager } from "../nonceManager.ts";
import { sendTransaction } from "../sendTransaction.ts";
import { transferStx } from "../transferStx.ts";

const ACCOUNT = privateKeyToAccount(
	"753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601",
);
const CONTRACT = `${ACCOUNT.address}.t`;
const ABI = {
	functions: [
		{
			name: "transfer",
			access: "public",
			args: [{ name: "amount", type: "uint128" }],
			outputs: { response: { ok: "bool", error: "uint128" } },
		},
	],
	maps: [],
} as const;

function noEstimateAvailable(): never {
	throw new HttpRequestError(400, {
		details: JSON.stringify({ reason: "NoEstimateAvailable" }),
	});
}

type Script = {
	confirmedNonce?: number;
	estimate?: () => unknown;
	broadcast: (nonce: bigint) => unknown;
};

/** Wallet client with a nonce manager whose node answers per `script`. */
function scriptedClient(script: Script) {
	const paths: string[] = [];
	const broadcastNonces: bigint[] = [];
	const request = async (
		path: string,
		// biome-ignore lint/suspicious/noExplicitAny: test transport stub
		options?: any,
	) => {
		paths.push(path);
		if (path.includes("/v2/accounts/")) {
			return { nonce: script.confirmedNonce ?? 6, balance: "0x0" };
		}
		if (path.includes("/v2/fees/transaction")) {
			return script.estimate
				? script.estimate()
				: { estimations: [{ fee_rate: 1, fee: 100 }] };
		}
		if (path.includes("/v2/transactions")) {
			const tx = deserializeTransaction(hexToBytes(options.body.tx));
			// biome-ignore lint/suspicious/noExplicitAny: spending condition shape
			const nonce = (tx.auth.spendingCondition as any).nonce as bigint;
			broadcastNonces.push(nonce);
			return script.broadcast(nonce);
		}
		throw new Error(`unexpected path ${path}`);
	};
	const client = createWalletClient({
		chain: mainnet,
		account: ACCOUNT,
		transport: custom({ request }),
		nonceManager: createNonceManager(),
	}) as unknown as Client;
	const peek = () =>
		// biome-ignore lint/style/noNonNullAssertion: manager configured above
		client.nonceManager!.peek({ client, address: ACCOUNT.address });
	return { client, paths, broadcastNonces, peek };
}

describe("nonce is handed back when a send never reaches the mempool", () => {
	it("FeeTooLow rejection reuses the same nonce on the next send", async () => {
		let attempts = 0;
		const { client, broadcastNonces, peek } = scriptedClient({
			broadcast: () => {
				attempts++;
				if (attempts === 1) {
					throw new HttpRequestError(400, {
						details: JSON.stringify({
							error: "transaction rejected",
							reason: "FeeTooLow",
							reason_data: { expected: 200, actual: 100 },
						}),
					});
				}
				return "0xabc";
			},
		});
		const params = {
			contract: CONTRACT,
			functionName: "transfer",
			functionArgs: [],
		};
		await expect(callContract(client, params)).rejects.toBeInstanceOf(
			BroadcastError,
		);
		expect(await peek()).toBe(6n);
		await callContract(client, { ...params, fee: 500n });
		expect(broadcastNonces).toEqual([6n, 6n]);
	});

	it("an estimator outage surfaces and does not burn the nonce", async () => {
		const { client, peek } = scriptedClient({
			estimate: () => {
				throw new HttpRequestError(503, { details: "upstream down" });
			},
			broadcast: () => "0xabc",
		});
		await expect(
			transferStx(client, { to: ACCOUNT.address, amount: 1n }),
		).rejects.toBeInstanceOf(HttpRequestError);
		expect(await peek()).toBe(6n);
	});

	it("a nonce conflict still resets the manager to the confirmed floor", async () => {
		const { client, peek } = scriptedClient({
			broadcast: () => {
				throw new HttpRequestError(400, {
					details: JSON.stringify({
						error: "transaction rejected",
						reason: "ConflictingNonceInMempool",
					}),
				});
			},
		});
		await expect(
			transferStx(client, { to: ACCOUNT.address, amount: 1n, fee: 200n }),
		).rejects.toBeInstanceOf(BroadcastError);
		expect(await peek()).toBeUndefined();
	});

	it("an explicit nonce is never released into the manager", async () => {
		const { client, peek } = scriptedClient({
			broadcast: () => {
				throw new HttpRequestError(400, {
					details: JSON.stringify({
						error: "transaction rejected",
						reason: "FeeTooLow",
					}),
				});
			},
		});
		await expect(
			transferStx(client, {
				to: ACCOUNT.address,
				amount: 1n,
				fee: 200n,
				nonce: 40n,
			}),
		).rejects.toBeInstanceOf(BroadcastError);
		expect(await peek()).toBeUndefined();
	});
});

describe("contract.buildCall", () => {
	it("reads the confirmed nonce without consuming the manager, and floors the fee on NoEstimateAvailable", async () => {
		const { client, peek } = scriptedClient({
			estimate: noEstimateAvailable,
			broadcast: () => "0xabc",
		});
		const contract = getContract({
			client,
			address: ACCOUNT.address,
			name: "t",
			abi: ABI,
		});
		const unsigned = await contract.buildCall.transfer({ amount: 1n });
		// biome-ignore lint/suspicious/noExplicitAny: spending condition shape
		const condition = unsigned.auth.spendingCondition as any;
		expect(condition.nonce).toBe(6n);
		expect(condition.fee).toBeGreaterThan(0n);
		expect(await peek()).toBeUndefined();

		// The manager is untouched, so the next managed send starts at 6.
		await callContract(client, {
			contract: CONTRACT,
			functionName: "transfer",
			functionArgs: [],
			fee: 200n,
		});
		expect(await peek()).toBe(7n);
	});

	it("rethrows an estimator transport failure", async () => {
		const { client } = scriptedClient({
			estimate: () => {
				throw new HttpRequestError(502, { details: "bad gateway" });
			},
			broadcast: () => "0xabc",
		});
		const contract = getContract({
			client,
			address: ACCOUNT.address,
			name: "t",
			abi: ABI,
		});
		await expect(contract.buildCall.transfer({ amount: 1n })).rejects.toThrow(
			HttpRequestError,
		);
	});
});

describe("sendTransaction after a broadcast timeout", () => {
	function signed() {
		return signTransactionWithAccount(
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
	}

	function timingOutClient(found: boolean) {
		const options: unknown[] = [];
		const request = async (
			path: string,
			// biome-ignore lint/suspicious/noExplicitAny: test transport stub
			opts?: any,
		) => {
			if (path.includes("/v2/transactions")) {
				options.push(opts);
				throw new TimeoutError({
					method: "POST",
					url: `http://node.test${path}`,
					timeout: 10,
					attempt: 0,
				});
			}
			if (path.includes("/extended/v1/tx/")) {
				if (!found) throw new HttpRequestError(404);
				return { tx_status: "pending" };
			}
			throw new Error(`unexpected path ${path}`);
		};
		const client = createWalletClient({
			chain: mainnet,
			account: ACCOUNT,
			transport: custom({ request }),
		}) as unknown as Client;
		return { client, options };
	}

	it("disables transport retries for the broadcast", async () => {
		const { client, options } = timingOutClient(true);
		await sendTransaction(client, { transaction: await signed() });
		expect((options[0] as { retryCount: number }).retryCount).toBe(0);
	});

	it("returns the txid when the node already knows the transaction", async () => {
		const { client } = timingOutClient(true);
		const transaction = await signed();
		const result = await sendTransaction(client, { transaction });
		expect(result.txid).toBe(getTransactionId(transaction));
	});

	it("surfaces the TimeoutError when the node has no record of the transaction", async () => {
		const { client } = timingOutClient(false);
		await expect(
			sendTransaction(client, { transaction: await signed() }),
		).rejects.toBeInstanceOf(TimeoutError);
	});
});
