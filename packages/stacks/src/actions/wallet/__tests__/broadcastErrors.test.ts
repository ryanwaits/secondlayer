import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../../chains/definitions.ts";
import { createWalletClient } from "../../../clients/createWalletClient.ts";
import type { Client } from "../../../clients/types.ts";
import { BroadcastError } from "../../../errors/transaction.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import {
	getTransactionId,
	signTransactionWithAccount,
} from "../../../transactions/signer.ts";
import { custom } from "../../../transports/custom.ts";
import { isNonceConflictError } from "../nonceManager.ts";
import { sendTransaction } from "../sendTransaction.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

async function signedTransfer() {
	const unsigned = buildTokenTransfer({
		recipient: ACCOUNT.address,
		amount: 1000n,
		fee: 200n,
		nonce: 0n,
		publicKey: ACCOUNT.publicKey,
		chain: mainnet,
	});
	return signTransactionWithAccount(unsigned, ACCOUNT);
}

function rejectingClient(rejection: Record<string, unknown>): Client {
	const request = async (path: string) => {
		if (path.includes("/v2/transactions")) return rejection;
		throw new Error(`unexpected path ${path}`);
	};
	return createWalletClient({
		chain: mainnet,
		account: ACCOUNT,
		transport: custom({ request }),
	}) as unknown as Client;
}

async function captureBroadcastError(
	rejection: Record<string, unknown>,
): Promise<BroadcastError> {
	const client = rejectingClient(rejection);
	try {
		await sendTransaction(client, { transaction: await signedTransfer() });
	} catch (e) {
		expect(e).toBeInstanceOf(BroadcastError);
		return e as BroadcastError;
	}
	throw new Error("sendTransaction did not throw");
}

describe("BroadcastError shape from node rejections", () => {
	it("attaches typed reason, reasonData, and node txid", async () => {
		const nodeTxid = "cc".repeat(32);
		const err = await captureBroadcastError({
			error: "transaction rejected",
			reason: "BadNonce",
			reason_data: {
				expected: 5,
				actual: 3,
				is_origin: true,
				principal: ACCOUNT.address,
			},
			txid: nodeTxid,
		});
		expect(err.reason).toBe("BadNonce");
		expect(err.txid).toBe(nodeTxid);
		expect(err.reasonData).toEqual({
			expected: 5,
			actual: 3,
			is_origin: true,
			principal: ACCOUNT.address,
		});
	});

	it("computes txid locally when the node omits it", async () => {
		const tx = await signedTransfer();
		const client = rejectingClient({
			error: "transaction rejected",
			reason: "FeeTooLow",
			reason_data: { expected: 180, actual: 1 },
		});
		try {
			await sendTransaction(client, { transaction: tx });
			throw new Error("did not throw");
		} catch (e) {
			const err = e as BroadcastError;
			expect(err.reason).toBe("FeeTooLow");
			expect(err.txid).toBe(getTransactionId(tx));
		}
	});

	it("reasons without reason_data leave reasonData undefined", async () => {
		const err = await captureBroadcastError({
			error: "transaction rejected",
			reason: "ConflictingNonceInMempool",
		});
		expect(err.reason).toBe("ConflictingNonceInMempool");
		expect(err.reasonData).toBeUndefined();
	});
});

describe("isNonceConflictError with typed reasons", () => {
	it("matches the two nonce rejection reasons exactly", () => {
		for (const reason of ["ConflictingNonceInMempool", "BadNonce"]) {
			expect(
				isNonceConflictError(new BroadcastError("rejected", { reason })),
			).toBe(true);
		}
	});

	it("trusts a typed non-nonce reason even if the message mentions nonce", () => {
		const err = new BroadcastError("fee too low for nonce 3", {
			reason: "FeeTooLow",
		});
		expect(isNonceConflictError(err)).toBe(false);
	});

	it("falls back to message matching when no reason is present", () => {
		expect(isNonceConflictError(new BroadcastError("BadNonce"))).toBe(true);
		expect(isNonceConflictError(new BroadcastError("NotEnoughFunds"))).toBe(
			false,
		);
	});
});
