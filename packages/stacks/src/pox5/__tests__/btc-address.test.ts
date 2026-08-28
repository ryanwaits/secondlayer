import { describe, expect, test } from "bun:test";
import { base58 } from "@scure/base";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { Cl } from "../../clarity/values.ts";
import { POX_ADDRESS_VERSION } from "../../pox/constants.ts";
import { parseBtcAddress as parseBtcAddressFrozen } from "../../pox/utils.ts";
import {
	BtcAddress,
	parseBtcAddress,
	stringifyBtcAddress,
} from "../btcAddress.ts";
import { buildSignerCalldata, parseSignerCalldata } from "../signerCalldata.ts";

const P2PKH_MAINNET = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH_MAINNET = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const P2WPKH_MAINNET = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH_MAINNET =
	"bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej";
const P2TR_MAINNET =
	"bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const P2WPKH_TESTNET = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

function expectMatchesFrozen(address: string) {
	const ours = parseBtcAddress(address);
	const frozen = parseBtcAddressFrozen(address);
	expect(ours.version).toBe(frozen.version[0]);
	expect(ours.hashbytes).toEqual(
		frozen.hashbytes.slice(0, ours.hashbytes.length),
	);
	expect(
		frozen.hashbytes.slice(ours.hashbytes.length).every((b) => b === 0),
	).toBe(true);
}

describe("parseBtcAddress / stringifyBtcAddress", () => {
	test("round-trips mainnet P2WPKH (BIP173 vector)", () => {
		const repr = parseBtcAddress(P2WPKH_MAINNET);
		expect(repr.version).toBe(POX_ADDRESS_VERSION.p2wpkh);
		expect(repr.hashbytes.length).toBe(20);
		expect(stringifyBtcAddress(repr, "mainnet")).toBe(P2WPKH_MAINNET);
		expect(
			BtcAddress.stringify(BtcAddress.parse(P2WPKH_MAINNET), "mainnet"),
		).toBe(P2WPKH_MAINNET);
	});

	test("round-trips mainnet P2TR (BIP350 vector)", () => {
		const repr = parseBtcAddress(P2TR_MAINNET);
		expect(repr.version).toBe(POX_ADDRESS_VERSION.p2tr);
		expect(repr.hashbytes.length).toBe(32);
		expect(stringifyBtcAddress(repr, "mainnet")).toBe(P2TR_MAINNET);
	});

	test("round-trips legacy P2PKH", () => {
		const repr = parseBtcAddress(P2PKH_MAINNET);
		expect(repr.version).toBe(POX_ADDRESS_VERSION.p2pkh);
		expect(repr.hashbytes.length).toBe(20);
		expect(stringifyBtcAddress(repr, "mainnet")).toBe(P2PKH_MAINNET);
	});

	test("round-trips testnet P2WPKH", () => {
		const repr = parseBtcAddress(P2WPKH_TESTNET);
		expect(repr.version).toBe(POX_ADDRESS_VERSION.p2wpkh);
		expect(stringifyBtcAddress(repr, "testnet")).toBe(P2WPKH_TESTNET);
	});

	test("round-trips P2SH and P2WSH", () => {
		expect(stringifyBtcAddress(parseBtcAddress(P2SH_MAINNET), "mainnet")).toBe(
			P2SH_MAINNET,
		);
		expect(stringifyBtcAddress(parseBtcAddress(P2WSH_MAINNET), "mainnet")).toBe(
			P2WSH_MAINNET,
		);
		expect(parseBtcAddress(P2SH_MAINNET).version).toBe(
			POX_ADDRESS_VERSION.p2sh,
		);
		expect(parseBtcAddress(P2WSH_MAINNET).version).toBe(
			POX_ADDRESS_VERSION.p2wsh,
		);
	});

	test("stringifies the same hash onto testnet / regtest", () => {
		const p2pkh = parseBtcAddress(P2PKH_MAINNET);
		const testnetLegacy = stringifyBtcAddress(p2pkh, "testnet");
		expect(testnetLegacy.startsWith("m") || testnetLegacy.startsWith("n")).toBe(
			true,
		);
		expect(parseBtcAddress(testnetLegacy)).toEqual(p2pkh);

		const p2wpkh = parseBtcAddress(P2WPKH_MAINNET);
		const regtest = stringifyBtcAddress(p2wpkh, "regtest");
		expect(regtest.startsWith("bcrt1")).toBe(true);
		expect(parseBtcAddress(regtest)).toEqual(p2wpkh);
	});

	test("stringifies nested p2sh versions as P2SH", () => {
		const hashbytes = parseBtcAddress(P2SH_MAINNET).hashbytes;
		const nested = stringifyBtcAddress(
			{ version: POX_ADDRESS_VERSION.p2sh_p2wpkh, hashbytes },
			"mainnet",
		);
		expect(nested).toBe(P2SH_MAINNET);
		expect(parseBtcAddress(nested).version).toBe(POX_ADDRESS_VERSION.p2sh);
	});

	test("accepts frozen-pox 32-byte padded hashbytes on stringify", () => {
		const frozen = parseBtcAddressFrozen(P2WPKH_MAINNET);
		expect(
			stringifyBtcAddress(
				{ version: frozen.version[0] as number, hashbytes: frozen.hashbytes },
				"mainnet",
			),
		).toBe(P2WPKH_MAINNET);
	});

	test("cross-checks version byte + hash against frozen pox/utils.ts", () => {
		for (const address of [
			P2PKH_MAINNET,
			P2SH_MAINNET,
			P2WPKH_MAINNET,
			P2WSH_MAINNET,
			P2TR_MAINNET,
			P2WPKH_TESTNET,
		]) {
			expectMatchesFrozen(address);
		}
	});

	test("throws on invalid addresses and unknown versions", () => {
		expect(() => parseBtcAddress("invalid")).toThrow();
		expect(() => parseBtcAddress("")).toThrow();
		expect(() =>
			stringifyBtcAddress(
				{ version: 0x99, hashbytes: new Uint8Array(20) },
				"mainnet",
			),
		).toThrow(/Unknown PoX address version/);
	});

	test("rejects a legacy address with a bad checksum", () => {
		const decoded = base58.decode(P2PKH_MAINNET);
		decoded[24] ^= 1;
		expect(() => parseBtcAddress(base58.encode(decoded))).toThrow(/checksum/);
	});
});

describe("buildSignerCalldata / parseSignerCalldata", () => {
	test("round-trips a Bitcoin address through the CV tuple", () => {
		const built = buildSignerCalldata({
			poxAddress: P2WPKH_MAINNET,
			maxFeeSats: 3_000n,
		});
		const parsed = parseSignerCalldata(built);
		expect(parsed.poxAddress).toEqual(parseBtcAddress(P2WPKH_MAINNET));
		expect(parsed.maxFeeSats).toBe(3_000n);
		expect(parseSignerCalldata(built).poxAddress).toEqual(
			parseBtcAddress(P2WPKH_MAINNET),
		);
	});

	test("accepts a BtcAddressRepr and hex calldata", () => {
		const repr = parseBtcAddress(P2TR_MAINNET);
		const built = buildSignerCalldata({
			poxAddress: repr,
			maxFeeSats: 0,
		});
		const hex = Array.from(built, (b) => b.toString(16).padStart(2, "0")).join(
			"",
		);
		const parsed = parseSignerCalldata(hex);
		expect(parsed.poxAddress).toEqual(repr);
		expect(parsed.maxFeeSats).toBe(0n);
	});

	test("preserves nested p2sh-p2wpkh version in the tuple (not via stringify)", () => {
		const hashbytes = parseBtcAddress(P2SH_MAINNET).hashbytes;
		const built = buildSignerCalldata({
			poxAddress: { version: POX_ADDRESS_VERSION.p2sh_p2wpkh, hashbytes },
			maxFeeSats: 1n,
		});
		expect(parseSignerCalldata(built).poxAddress.version).toBe(
			POX_ADDRESS_VERSION.p2sh_p2wpkh,
		);
	});

	test("throws on an invalid tuple", () => {
		expect(() => parseSignerCalldata(serializeCVBytes(Cl.uint(1)))).toThrow(
			/not a Clarity tuple/,
		);
		expect(() =>
			parseSignerCalldata(serializeCVBytes(Cl.tuple({ foo: Cl.uint(1) }))),
		).toThrow(/pox-addr/);
	});

	test("throws on an unknown pox-addr version byte", () => {
		const bad = serializeCVBytes(
			Cl.tuple({
				"pox-addr": Cl.tuple({
					version: Cl.buffer(Uint8Array.of(0x99)),
					hashbytes: Cl.buffer(new Uint8Array(20)),
				}),
				"max-fee": Cl.uint(1),
			}),
		);
		expect(() => parseSignerCalldata(bad)).toThrow(
			/Unknown PoX address version/,
		);
	});
});
