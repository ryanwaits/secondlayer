import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../../chains/definitions.ts";
import { createWalletClient } from "../../../clients/createWalletClient.ts";
import type { Client } from "../../../clients/types.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import type { StacksTransaction } from "../../../transactions/types.ts";
import { deserializeTransaction } from "../../../transactions/wire/deserialize.ts";
import { serializeTransaction } from "../../../transactions/wire/serialize.ts";
import { custom } from "../../../transports/custom.ts";
import { hexToBytes } from "../../../utils/encoding.ts";
import { sponsorTransaction } from "../sponsorTransaction.ts";
import { transferStx } from "../transferStx.ts";
import {
	assertNoFeeTierForProvider,
	isFeeTier,
	minimumFee,
	resolveFee,
} from "../utils.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));
const TXID = `0x${"ab".repeat(32)}`;

const THREE_ESTIMATES = {
	estimations: [
		{ fee_rate: 1, fee: 100 },
		{ fee_rate: 2, fee: 250 },
		{ fee_rate: 3, fee: 900 },
	],
};

function buildUnsigned(): StacksTransaction {
	return buildTokenTransfer({
		recipient: ACCOUNT.address,
		amount: 1000n,
		fee: 0n,
		nonce: 0n,
		publicKey: ACCOUNT.publicKey,
		chain: mainnet,
	});
}

/** Client whose /v2/fees/transaction responds with `estimate` (or throws). */
function estimatingClient(
	estimate: unknown | (() => never),
	broadcastFees?: bigint[],
): Client {
	const request = async (
		path: string,
		// biome-ignore lint/suspicious/noExplicitAny: test transport stub
		options?: any,
	) => {
		if (path.includes("/v2/accounts/")) return { nonce: 0 };
		if (path.includes("/v2/fees/transaction")) {
			if (typeof estimate === "function") (estimate as () => never)();
			return estimate;
		}
		if (path.includes("/v2/transactions")) {
			const tx = deserializeTransaction(hexToBytes(options.body.tx));
			// biome-ignore lint/suspicious/noExplicitAny: spending condition shape
			broadcastFees?.push((tx.auth.spendingCondition as any).fee);
			return TXID;
		}
		throw new Error(`unexpected path ${path}`);
	};
	return createWalletClient({
		chain: mainnet,
		account: ACCOUNT,
		transport: custom({ request }),
	}) as unknown as Client;
}

describe("isFeeTier", () => {
	it("accepts the four tier names and rejects everything else", () => {
		expect(isFeeTier("min")).toBe(true);
		expect(isFeeTier("low")).toBe(true);
		expect(isFeeTier("mid")).toBe(true);
		expect(isFeeTier("high")).toBe(true);
		expect(isFeeTier(100n)).toBe(false);
		expect(isFeeTier(100)).toBe(false);
		expect(isFeeTier(undefined)).toBe(false);
	});
});

describe("resolveFee", () => {
	it("passes numeric fees through without a network call", async () => {
		const client = estimatingClient(() => {
			throw new Error("estimate must not be called");
		});
		expect(await resolveFee(client, buildUnsigned(), 123n)).toBe(123n);
		expect(await resolveFee(client, buildUnsigned(), 456)).toBe(456n);
	});

	it("maps low/mid/high to estimations[0/1/2]", async () => {
		const client = estimatingClient(THREE_ESTIMATES);
		const tx = buildUnsigned();
		expect(await resolveFee(client, tx, "low")).toBe(100n);
		expect(await resolveFee(client, tx, "mid")).toBe(250n);
		expect(await resolveFee(client, tx, "high")).toBe(900n);
	});

	it("defaults to mid when fee is undefined", async () => {
		const client = estimatingClient(THREE_ESTIMATES);
		expect(await resolveFee(client, buildUnsigned(), undefined)).toBe(250n);
	});

	it("falls back to the nearest present estimation", async () => {
		const client = estimatingClient({
			estimations: [{ fee_rate: 1, fee: 100 }],
		});
		expect(await resolveFee(client, buildUnsigned(), "high")).toBe(100n);
	});

	it("min is the serialized byte length, no network call", async () => {
		const client = estimatingClient(() => {
			throw new Error("estimate must not be called");
		});
		const tx = buildUnsigned();
		const expected = BigInt(serializeTransaction(tx).length);
		expect(await resolveFee(client, tx, "min")).toBe(expected);
		expect(minimumFee(tx)).toBe(expected);
	});

	it("min is stable regardless of the fee value already set", () => {
		const cheap = buildUnsigned();
		const pricey = buildTokenTransfer({
			recipient: ACCOUNT.address,
			amount: 1000n,
			fee: 123_456_789n,
			nonce: 0n,
			publicKey: ACCOUNT.publicKey,
			chain: mainnet,
		});
		expect(minimumFee(cheap)).toBe(minimumFee(pricey));
	});

	it("falls back to min when estimation throws", async () => {
		const client = estimatingClient(() => {
			throw new Error("NoEstimateAvailable");
		});
		const tx = buildUnsigned();
		expect(await resolveFee(client, tx, "mid")).toBe(minimumFee(tx));
	});

	it("falls back to min when estimation is empty", async () => {
		const client = estimatingClient({ estimations: [] });
		const tx = buildUnsigned();
		expect(await resolveFee(client, tx, "high")).toBe(minimumFee(tx));
	});
});

describe("fee tiers in wallet actions", () => {
	it("transferStx with fee: 'high' broadcasts estimations[2].fee", async () => {
		const fees: bigint[] = [];
		const client = estimatingClient(THREE_ESTIMATES, fees);
		await transferStx(client, {
			to: ACCOUNT.address,
			amount: 1000n,
			fee: "high",
		});
		expect(fees).toEqual([900n]);
	});

	it("transferStx with estimate failure broadcasts the min fee, not 0", async () => {
		const fees: bigint[] = [];
		const client = estimatingClient(() => {
			throw new Error("NoEstimateAvailable");
		}, fees);
		await transferStx(client, { to: ACCOUNT.address, amount: 1000n });
		expect(fees).toHaveLength(1);
		expect(fees[0]).toBeGreaterThan(0n);
	});

	it("sponsorTransaction resolves min on estimate failure instead of 0n", async () => {
		const client = estimatingClient(() => {
			throw new Error("NoEstimateAvailable");
		});
		const { buildContractCall } = await import(
			"../../../transactions/build.ts"
		);
		const inner = buildContractCall({
			contractAddress: ACCOUNT.address,
			contractName: "counter",
			functionName: "increment",
			functionArgs: [],
			fee: 0n,
			nonce: 0n,
			publicKey: ACCOUNT.publicKey,
			chain: mainnet,
			sponsored: true,
		});
		const sponsored = await sponsorTransaction(client, { transaction: inner });
		// biome-ignore lint/suspicious/noExplicitAny: spending condition shape
		const fee = (sponsored.auth as any).sponsorSpendingCondition.fee;
		expect(fee).toBeGreaterThan(0n);
	});
});

describe("provider accounts", () => {
	it("assertNoFeeTierForProvider throws on tiers, allows numeric/undefined", () => {
		expect(() => assertNoFeeTierForProvider("low")).toThrow(/local signing/);
		expect(() => assertNoFeeTierForProvider(100n)).not.toThrow();
		expect(() => assertNoFeeTierForProvider(undefined)).not.toThrow();
	});

	it("transferStx throws when a provider account gets a fee tier", async () => {
		const providerAccount = {
			type: "provider",
			address: ACCOUNT.address,
			publicKey: ACCOUNT.publicKey,
			provider: {
				request: async () => ({ txid: TXID }),
			},
		};
		const client = createWalletClient({
			chain: mainnet,
			// biome-ignore lint/suspicious/noExplicitAny: minimal provider stub
			account: providerAccount as any,
			transport: custom({ request: async () => ({}) }),
		}) as unknown as Client;

		await expect(
			transferStx(client, { to: ACCOUNT.address, amount: 1n, fee: "low" }),
		).rejects.toThrow(/local signing/);
	});
});
