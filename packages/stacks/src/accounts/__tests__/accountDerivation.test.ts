import { beforeAll, describe, expect, test } from "bun:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { etc } from "@noble/secp256k1";
import { utf8ToBytes } from "../../utils/encoding.ts";
import { recoverPublicKey, verifySignature } from "../../utils/signature.ts";
import { mnemonicToAccount, privateKeyToAccount } from "../index.ts";

beforeAll(() => {
	etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
		const h = hmac.create(sha256, key);
		for (const msg of msgs) h.update(msg);
		return h.digest();
	};
});

// --- Reference vectors ---
// Self-generated from the current implementation; serve as regression baselines.

const PK_ALL_ONES = "11".repeat(32);

const PK_ACCOUNT = {
	address: "SP3Y74M5227FDVHREWPH773F5Y1W1ED8WXY3RAVG4",
	publicKey:
		"034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
	testnetAddress: "ST3Y74M5227FDVHREWPH773F5Y1W1ED8WXXVB0G1S",
};

const MNEMONIC =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const MNEMONIC_ACCOUNT = {
	address: "SPC5KHM41H6WHAST7MWWDD807YSPRQKJ69FSH54J",
	publicKey:
		"03d5d038bce81b3965314dba54f636f093c7dbdd6617cded013a53474fbccb100c",
};

const MNEMONIC_ACCOUNT_INDEX_1 = {
	address: "SP3XHES5990FYDV5BHBZCJRFYFD2Z4X3FMD2N3MGH",
	publicKey:
		"03121507b88c654be90c0973965b73f5b25597c393eb95b0a206d4217ee725582a",
};

describe("privateKeyToAccount", () => {
	test("derives the correct Stacks mainnet address", () => {
		const account = privateKeyToAccount(PK_ALL_ONES);
		expect(account.address).toBe(PK_ACCOUNT.address);
	});

	test("derives the correct compressed public key", () => {
		const account = privateKeyToAccount(PK_ALL_ONES);
		expect(account.publicKey).toBe(PK_ACCOUNT.publicKey);
	});

	test("derives the correct testnet address with addressVersion 26", () => {
		const account = privateKeyToAccount(PK_ALL_ONES, { addressVersion: 26 });
		expect(account.address).toBe(PK_ACCOUNT.testnetAddress);
	});

	test("signMessage returns a 65-byte recoverable signature that recovers the public key", () => {
		const account = privateKeyToAccount(PK_ALL_ONES);
		const message = "hello world";
		const sigHex = account.signMessage(message);

		expect(sigHex).toMatch(/^[0-9a-f]{130}$/);

		const msgHash = sha256(utf8ToBytes(message));
		const recovered = recoverPublicKey(msgHash, sigHex, true);
		expect(recovered).toBe(account.publicKey);
	});

	test("signMessage signature verifies against the derived public key", () => {
		const account = privateKeyToAccount(PK_ALL_ONES);
		const message = "hello world";
		const sigHex = account.signMessage(message);

		const msgHash = sha256(utf8ToBytes(message));
		const compactSig = sigHex.slice(2); // strip recovery byte
		expect(verifySignature(msgHash, compactSig, account.publicKey)).toBe(true);
	});
});

describe("mnemonicToAccount", () => {
	test("derives the correct Stacks mainnet address from BIP-39 vector #1", () => {
		const account = mnemonicToAccount(MNEMONIC);
		expect(account.address).toBe(MNEMONIC_ACCOUNT.address);
	});

	test("derives the correct compressed public key", () => {
		const account = mnemonicToAccount(MNEMONIC);
		expect(account.publicKey).toBe(MNEMONIC_ACCOUNT.publicKey);
	});

	test("accountIndex changes the derived address", () => {
		const account0 = mnemonicToAccount(MNEMONIC);
		const account1 = mnemonicToAccount(MNEMONIC, { accountIndex: 1 });

		expect(account1.address).toBe(MNEMONIC_ACCOUNT_INDEX_1.address);
		expect(account1.publicKey).toBe(MNEMONIC_ACCOUNT_INDEX_1.publicKey);
		expect(account0.address).not.toBe(account1.address);
	});

	test("signMessage returns a 65-byte recoverable signature that recovers the public key", () => {
		const account = mnemonicToAccount(MNEMONIC);
		const message = " Stacks message";
		const sigHex = account.signMessage(message);

		expect(sigHex).toMatch(/^[0-9a-f]{130}$/);

		const msgHash = sha256(utf8ToBytes(message));
		const recovered = recoverPublicKey(msgHash, sigHex, true);
		expect(recovered).toBe(account.publicKey);
	});

	test("signMessage signature verifies against the derived public key", () => {
		const account = mnemonicToAccount(MNEMONIC);
		const message = " Stacks message";
		const sigHex = account.signMessage(message);

		const msgHash = sha256(utf8ToBytes(message));
		const compactSig = sigHex.slice(2);
		expect(verifySignature(msgHash, compactSig, account.publicKey)).toBe(true);
	});
});
