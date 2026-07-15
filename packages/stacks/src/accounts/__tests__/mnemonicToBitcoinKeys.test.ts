import { describe, expect, it } from "bun:test";
import {
	publicKeyToP2trAddress,
	publicKeyToP2wpkhAddress,
	taprootTweakPubkey,
} from "../../bitcoin/address.ts";
import { hexToBytes } from "../../utils/encoding.ts";
import { mnemonicToBitcoinKeys } from "../mnemonicToBitcoinKeys.ts";

// The reference mnemonic used by the BIP84 and BIP86 specs.
const MNEMONIC =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("taprootTweakPubkey (BIP341/BIP86 vectors)", () => {
	it("matches the BIP86 account-0 first-receive output key", () => {
		// internal key / output key from BIP86 test vectors
		const internal = hexToBytes(
			"cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
		);
		const output = taprootTweakPubkey(internal);
		expect(Buffer.from(output).toString("hex")).toBe(
			"a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c",
		);
	});

	it("rejects a non-32-byte input", () => {
		expect(() => taprootTweakPubkey(new Uint8Array(33))).toThrow(/32-byte/);
	});
});

describe("mnemonicToBitcoinKeys", () => {
	it("BIP84 vector: first receive address", () => {
		const keys = mnemonicToBitcoinKeys(MNEMONIC, { type: "p2wpkh" });
		expect(keys.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
		expect(keys.path).toBe("m/84'/0'/0'/0/0");
	});

	it("BIP84 vector: second receive + first change address", () => {
		expect(
			mnemonicToBitcoinKeys(MNEMONIC, { type: "p2wpkh", addressIndex: 1 })
				.address,
		).toBe("bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g");
		expect(
			mnemonicToBitcoinKeys(MNEMONIC, { type: "p2wpkh", changeIndex: 1 })
				.address,
		).toBe("bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el");
	});

	it("BIP86 vector: first receive address", () => {
		const keys = mnemonicToBitcoinKeys(MNEMONIC, { type: "p2tr" });
		expect(keys.address).toBe(
			"bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
		);
		expect(keys.path).toBe("m/86'/0'/0'/0/0");
	});

	it("BIP86 vector: second receive + first change address", () => {
		expect(
			mnemonicToBitcoinKeys(MNEMONIC, { type: "p2tr", addressIndex: 1 })
				.address,
		).toBe("bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh");
		expect(
			mnemonicToBitcoinKeys(MNEMONIC, { type: "p2tr", changeIndex: 1 }).address,
		).toBe("bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7");
	});

	it("testnet and regtest derive coin type 1' with the right prefixes", () => {
		const tb = mnemonicToBitcoinKeys(MNEMONIC, {
			type: "p2wpkh",
			network: "testnet",
		});
		expect(tb.path).toBe("m/84'/1'/0'/0/0");
		expect(tb.address.startsWith("tb1q")).toBe(true);

		const bcrt = mnemonicToBitcoinKeys(MNEMONIC, {
			type: "p2tr",
			network: "regtest",
		});
		expect(bcrt.path).toBe("m/86'/1'/0'/0/0");
		expect(bcrt.address.startsWith("bcrt1p")).toBe(true);
	});

	it("returns hex keys consistent with the address", () => {
		const keys = mnemonicToBitcoinKeys(MNEMONIC, { type: "p2wpkh" });
		expect(keys.privateKey).toMatch(/^[0-9a-f]{64}$/);
		expect(keys.publicKey).toMatch(/^[0-9a-f]{66}$/);
		expect(publicKeyToP2wpkhAddress(keys.publicKey)).toBe(keys.address);
	});
});

describe("publicKeyToP2trAddress input handling", () => {
	it("accepts compressed and x-only forms equivalently", () => {
		const keys = mnemonicToBitcoinKeys(MNEMONIC, { type: "p2tr" });
		const compressed = hexToBytes(keys.publicKey);
		expect(publicKeyToP2trAddress(compressed)).toBe(
			publicKeyToP2trAddress(compressed.slice(1)),
		);
	});

	it("rejects other lengths", () => {
		expect(() => publicKeyToP2trAddress(new Uint8Array(20))).toThrow(
			/33-byte compressed or 32-byte/,
		);
		expect(() => publicKeyToP2wpkhAddress(new Uint8Array(32))).toThrow(
			/33-byte compressed/,
		);
	});
});
