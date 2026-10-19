import { describe, expect, it } from "bun:test";
import { HDKey } from "@scure/bip32";
import { publicKeyToP2trAddress } from "../../bitcoin/address.ts";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import {
	SBTC_V2_INTERNAL_KEY,
	SbtcV2MarkerError,
	assertRegistryAggregateKey,
	deriveSbtcSigningKey,
	deriveSbtcV2PegOutput,
} from "../peg.ts";

// Vectors from the sBTC signer, `sbtc/src/signer_keys.rs`
// `key_set_script_pubkey_is_stable` (checked there against Bitcoin Core's
// `deriveaddresses` on the xpub descriptor).
const DEVENV_SIGNER_KEYS = [
	"035249137286c077ccee65ecc43e724b9b9e5a588e3d7f51e3b62f9624c2a49e46",
	"031a4d9f4903da97498945a4e01a5023a1d53bc96ad670bfe03adf8a06c52e6380",
	"02007311430123d4cad97f4f7e86e023b28143130a18099ecf094d36fef0f6135c",
];
const TESTNET_SIGNER_KEYS = [
	"03fc6197a1396680f7acc4241ac3935ba4af560deac0224abec45c47c5e73ea638",
	"0390d76b21867e9c5aa25a903423d3ddb0da65604f0470390ed903f2056c5adb4b",
	"03fb16c76ae6773951b2ea957f723dc0f5f4ccd795313793308a38a37a3c4aa582",
	"024681893c76fb2d52bdbcd6341c66f15f14698aed638d6c1a2fc9440948b5f11a",
	"0341a8f3562d805ab240c2ce2dd220313329ef75459f115bd818b250a2ad2df6aa",
	"02a963be44cd7efd07e59e28f02f5d2bafdf28b5b13b3b13b5c2a9e3f4c1b1e5bf",
	"03c4382afb075bf577acbb13196e6130c386a3d8261326402f587fb7c42d0dbd5e",
	"02c2b53974a2b1a05103a7c42a4861c859c9b999ed196c065bcec952438ae8ec9b",
	"034646af6402dab3a265688b2ea67a7aa88d9fc6eca663385a6e92336f7f081c59",
	"02629d043197e659ac45f0332b219760b9542d22499ff6431c113ec64d60e86628",
	"033f3dd6b1e8e4cfff219054dce240d312b6deda10386c3a815459224a2ba0f411",
	"031c7e1267b272d5a11257f46c61e0e5005337ebcebb6f2b71798addfd04e5a38a",
	"02ae3a560f4f67ce8c0f4b2e46d24f51232a768cfc69cf08a02ea02426d77bd64c",
	"026fb0b3c3ea60a3197e94f2dcd37d7f302e6d33c75351f4f5024e9c31ac327c11",
	"0374e256948a14799c2a788960ab6657dc5d322b070abae4ce83b2a0df4df2c727",
];
const RANDOM_SIGNER_KEYS = [
	"027212421e4a9c34e251a7cd523146c4434451e42c230d576b07fe8874f97a694d",
];

const VECTORS: [string, string[], number, string][] = [
	[
		"devenv 2-of-3",
		DEVENV_SIGNER_KEYS,
		2,
		"512044d42c5fdc191818e50ec6591d2103f17ec2771c1a0ea5dc1db95ca56dd377b5",
	],
	[
		"testnet 11-of-15",
		TESTNET_SIGNER_KEYS,
		11,
		"512036beeeb78d2eff65baa60f8da199b5ecd06ee833dd3c8f6340f8b6d4102a595c",
	],
	[
		"random 1-of-1",
		RANDOM_SIGNER_KEYS,
		1,
		"5120a014d46c5ec41d7d059755296e1d12566ca7416d3707a7789d2a3c88ee1eeca2",
	],
];

// BIP341 NUMS point H (`NUMS_X_COORDINATE`, the v1 unspendable key).
const BIP341_NUMS_X =
	"50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

const keys = (hex: string[]) => hex.map(hexToBytes);

describe("sBTC v2 peg derivation", () => {
	for (const [name, signerKeys, threshold, scriptPubKey] of VECTORS) {
		it(`matches the sBTC signer vector: ${name}`, () => {
			const out = deriveSbtcV2PegOutput(keys(signerKeys), threshold);
			expect(bytesToHex(out.scriptPubKey)).toBe(scriptPubKey);
		});
	}

	it("is independent of registry key order", () => {
		const reversed = [...TESTNET_SIGNER_KEYS].reverse();
		expect(deriveSbtcV2PegOutput(keys(reversed), 11).scriptPubKey).toEqual(
			deriveSbtcV2PegOutput(keys(TESTNET_SIGNER_KEYS), 11).scriptPubKey,
		);
	});

	it("builds the canonical multi_a leaf", () => {
		const out = deriveSbtcV2PegOutput(keys(DEVENV_SIGNER_KEYS), 2);
		const script = bytesToHex(out.signingScript);
		const [k1, k2, k3] = out.signingKeys.map(bytesToHex);
		expect(script).toBe(`20${k1}ac20${k2}ba20${k3}ba529c`);
		expect([k1, k2, k3]).toEqual([k1, k2, k3].sort() as string[]);
	});

	it("encodes the address per network", () => {
		const out = deriveSbtcV2PegOutput(keys(DEVENV_SIGNER_KEYS), 2, "regtest");
		expect(out.address.startsWith("bcrt1p")).toBe(true);
		expect(
			deriveSbtcV2PegOutput(keys(DEVENV_SIGNER_KEYS), 2).address.startsWith(
				"bc1p",
			),
		).toBe(true);
	});

	it("uses the NUMS /0/0 child with a zero chain code as internal key", () => {
		const nums = new HDKey({
			publicKey: hexToBytes(`02${BIP341_NUMS_X}`),
			chainCode: new Uint8Array(32),
		});
		const child = nums.deriveChild(0).deriveChild(0).publicKey;
		expect(bytesToHex(child?.slice(1) ?? new Uint8Array())).toBe(
			bytesToHex(SBTC_V2_INTERNAL_KEY),
		);
	});

	it("derives x-only /0/0 signing keys", () => {
		expect(
			deriveSbtcSigningKey(hexToBytes(RANDOM_SIGNER_KEYS[0] as string)),
		).toHaveLength(32);
		expect(() =>
			deriveSbtcSigningKey(hexToBytes(`ff${"11".repeat(32)}`)),
		).toThrow();
	});

	it("rejects more than 16 signers and a bad threshold", () => {
		const seventeen = [...TESTNET_SIGNER_KEYS, ...DEVENV_SIGNER_KEYS];
		expect(() => deriveSbtcV2PegOutput(keys(seventeen), 12)).toThrow(
			/at most 16/,
		);
		expect(() => deriveSbtcV2PegOutput(keys(DEVENV_SIGNER_KEYS), 0)).toThrow(
			/threshold/,
		);
		expect(() => deriveSbtcV2PegOutput(keys(DEVENV_SIGNER_KEYS), 4)).toThrow(
			/threshold/,
		);
	});
});

describe("registry aggregate-key guard", () => {
	const body =
		"04cff1ade0cc7f74d1b5a2b7c7bee653cfb5e6c0dce360795d314c829c4aaf52";

	it("accepts 0x02 and 0x03 compressed keys", () => {
		for (const prefix of ["02", "03"]) {
			const key = hexToBytes(`${prefix}${body}`);
			expect(assertRegistryAggregateKey(key)).toBe(key);
		}
	});

	it("rejects the 0xFF v2 marker with SbtcV2MarkerError", () => {
		const marker = hexToBytes(`ff${body}`);
		expect(() => assertRegistryAggregateKey(marker)).toThrow(SbtcV2MarkerError);
		try {
			assertRegistryAggregateKey(marker);
		} catch (error) {
			expect((error as SbtcV2MarkerError).code).toBe("SBTC_V2_MARKER_ERROR");
		}
	});

	it("rejects other prefixes and wrong lengths", () => {
		expect(() => assertRegistryAggregateKey(hexToBytes(`04${body}`))).toThrow(
			/not a compressed public key/,
		);
		expect(() => assertRegistryAggregateKey(hexToBytes(body))).toThrow(
			/32 bytes/,
		);
		expect(() => assertRegistryAggregateKey(hexToBytes(`02${body}00`))).toThrow(
			/34 bytes/,
		);
		expect(() => assertRegistryAggregateKey(new Uint8Array())).toThrow(
			/0 bytes/,
		);
	});

	it("publicKeyToP2trAddress refuses a 33-byte non-key", () => {
		expect(() => publicKeyToP2trAddress(hexToBytes(`ff${body}`))).toThrow(
			/prefix 0x02 or 0x03, got 0xff/,
		);
		expect(publicKeyToP2trAddress(hexToBytes(`02${body}`))).toBe(
			"bc1p6ys2ervatu00766eeqfmverzegg9fkprn3xjn0ppn70h53qu5vus3yzl0x",
		);
	});
});
