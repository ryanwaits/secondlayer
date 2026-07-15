import { describe, expect, it } from "bun:test";
import { devnet, mainnet, testnet } from "../../chains/definitions.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import type { Client } from "../../clients/types.ts";
import { custom } from "../../transports/custom.ts";
import { hexToBytes } from "../../utils/encoding.ts";
import { getSignersAddress, getSignersPublicKey } from "../actions.ts";
import { SBTC_BTC_ADDRESS_VERSION } from "../constants.ts";
import { formatBtcAddress } from "../utils.ts";

// Live mainnet fixture (2026-07-14): sbtc-registry get-current-aggregate-pubkey
// and the taproot address it derives to — verified on-chain (the signers'
// deposit wallet, thousands of txs).
const AGGREGATE_PUBKEY_HEX =
	"0204cff1ade0cc7f74d1b5a2b7c7bee653cfb5e6c0dce360795d314c829c4aaf52";
const SIGNERS_ADDRESS_MAINNET =
	"bc1p6ys2ervatu00766eeqfmverzegg9fkprn3xjn0ppn70h53qu5vus3yzl0x";

// Clarity-serialized (buff 33): type 0x02, length 0x00000021, then the key.
const CALL_READ_RESULT = `0x0200000021${AGGREGATE_PUBKEY_HEX}`;
const EMPTY_RESULT = `0x02000000${"21"}${"00".repeat(33)}`;

function registryClient(
	chain: typeof mainnet,
	result: string = CALL_READ_RESULT,
): Client {
	const request = async (path: string) => {
		if (path.includes("/v2/contracts/call-read/")) {
			return { okay: true, result };
		}
		throw new Error(`unexpected path ${path}`);
	};
	return createPublicClient({
		chain,
		transport: custom({ request }),
	}) as unknown as Client;
}

describe("sbtc signers", () => {
	it("reads the aggregate pubkey from the registry", async () => {
		const pubkey = await getSignersPublicKey(registryClient(mainnet));
		expect(Buffer.from(pubkey).toString("hex")).toBe(AGGREGATE_PUBKEY_HEX);
	});

	it("derives the live mainnet signers address", async () => {
		expect(await getSignersAddress(registryClient(mainnet))).toBe(
			SIGNERS_ADDRESS_MAINNET,
		);
	});

	it("encodes testnet with tb1p — the upstream regtest-hardcode regression", async () => {
		const address = await getSignersAddress(registryClient(testnet));
		expect(address.startsWith("tb1p")).toBe(true);
	});

	it("encodes devnet with bcrt1p (regtest)", async () => {
		const address = await getSignersAddress(registryClient(devnet));
		expect(address.startsWith("bcrt1p")).toBe(true);
	});

	it("throws a descriptive error on an all-zero pubkey", async () => {
		await expect(
			getSignersPublicKey(registryClient(mainnet, EMPTY_RESULT)),
		).rejects.toThrow(/no aggregate pubkey/);
	});
});

describe("formatBtcAddress network param", () => {
	const p2wpkh = {
		version: SBTC_BTC_ADDRESS_VERSION.p2wpkh,
		hashbytes: hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6"),
	};

	it("defaults to mainnet (back-compat)", () => {
		expect(formatBtcAddress(p2wpkh)).toBe(
			"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
		);
	});

	it("encodes testnet and regtest hrps", () => {
		expect(formatBtcAddress(p2wpkh, "testnet")).toBe(
			"tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
		);
		expect(formatBtcAddress(p2wpkh, "regtest").startsWith("bcrt1q")).toBe(true);
	});

	it("uses network version bytes for legacy types", () => {
		const p2pkh = {
			version: SBTC_BTC_ADDRESS_VERSION.p2pkh,
			hashbytes: hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6"),
		};
		expect(formatBtcAddress(p2pkh).startsWith("1")).toBe(true);
		const t = formatBtcAddress(p2pkh, "testnet");
		expect(t.startsWith("m") || t.startsWith("n")).toBe(true);
	});
});
