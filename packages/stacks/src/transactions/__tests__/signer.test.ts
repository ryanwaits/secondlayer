import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { buildTokenTransfer } from "../build.ts";
import { serializeTransaction } from "../wire/serialize.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

describe("serializeTransaction memoization", () => {
	test("returns the same Uint8Array reference for repeated calls", () => {
		const tx = buildTokenTransfer({
			recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			amount: 1000n,
			fee: 200n,
			nonce: 0n,
			publicKey: ACCOUNT.publicKey,
		});

		const bytes1 = serializeTransaction(tx);
		const bytes2 = serializeTransaction(tx);
		expect(bytes1).toBe(bytes2); // same reference — no re-serialization
	});
});
