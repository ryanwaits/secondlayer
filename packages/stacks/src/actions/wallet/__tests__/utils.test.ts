import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "../../../accounts/privateKeyToAccount.ts";
import { buildTokenTransfer } from "../../../transactions/build.ts";
import { serializeTransaction } from "../../../transactions/wire/serialize.ts";
import { bytesToHex } from "../../../utils/encoding.ts";
import { setUnsignedFee } from "../utils.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

describe("setUnsignedFee", () => {
	test("invalidates the memoized serialization after mutation", () => {
		const tx = buildTokenTransfer({
			recipient: ACCOUNT.address,
			amount: 1000n,
			fee: 0n,
			nonce: 0n,
			publicKey: ACCOUNT.publicKey,
		});

		const before = serializeTransaction(tx);
		expect(serializeTransaction(tx)).toBe(before); // memoized

		setUnsignedFee(tx, 500n);

		const after = serializeTransaction(tx);
		expect(after).not.toBe(before); // cache invalidated, re-serialized
		expect(bytesToHex(after)).not.toBe(bytesToHex(before));
		expect(serializeTransaction(tx)).toBe(after); // memoized again
	});
});
