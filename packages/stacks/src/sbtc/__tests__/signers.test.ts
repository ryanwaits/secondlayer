import { describe, expect, it } from "bun:test";
import { devnet, mainnet, testnet } from "../../chains/definitions.ts";
import { serializeCV } from "../../clarity/serialize.ts";
import { Cl } from "../../clarity/values.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import type { Client } from "../../clients/types.ts";
import { custom } from "../../transports/custom.ts";
import { hexToBytes } from "../../utils/encoding.ts";
import {
	getSignerSet,
	getSignersAddress,
	getSignersPublicKey,
} from "../actions.ts";
import { SBTC_BTC_ADDRESS_VERSION } from "../constants.ts";
import {
	SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET,
	SbtcV2MarkerError,
	deriveSbtcV2PegOutput,
} from "../peg.ts";
import { formatBtcAddress } from "../utils.ts";

// Live mainnet fixture (2026-07-14): sbtc-registry get-current-aggregate-pubkey
// and the taproot address it derives to — verified on-chain (the signers'
// peg wallet, thousands of txs).
const AGGREGATE_PUBKEY_HEX =
	"0204cff1ade0cc7f74d1b5a2b7c7bee653cfb5e6c0dce360795d314c829c4aaf52";
const SIGNERS_ADDRESS_MAINNET =
	"bc1p6ys2ervatu00766eeqfmverzegg9fkprn3xjn0ppn70h53qu5vus3yzl0x";

// The devenv 2-of-3 signer set from the sBTC signer's
// `key_set_script_pubkey_is_stable` vectors.
const DEVENV_SIGNER_KEYS = [
	"035249137286c077ccee65ecc43e724b9b9e5a588e3d7f51e3b62f9624c2a49e46",
	"031a4d9f4903da97498945a4e01a5023a1d53bc96ad670bfe03adf8a06c52e6380",
	"02007311430123d4cad97f4f7e86e023b28143130a18099ecf094d36fef0f6135c",
];
const DEVENV_V2_OUTPUT_KEY =
	"44d42c5fdc191818e50ec6591d2103f17ec2771c1a0ea5dc1db95ca56dd377b5";

const V2_MARKER_HEX = `ff${"ab".repeat(32)}`;

function buff33Result(hex: string): string {
	return serializeCV(Cl.bufferFromHex(hex));
}

function signerDataResult(aggregateHex: string): string {
	return serializeCV(
		Cl.tuple({
			"current-aggregate-pubkey": Cl.bufferFromHex(aggregateHex),
			"current-signature-threshold": Cl.uint(2),
			"current-signer-principal": Cl.principal(
				"SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8",
			),
			"current-signer-set": Cl.list(
				DEVENV_SIGNER_KEYS.map((key) => Cl.bufferFromHex(key)),
			),
		}),
	);
}

function registryClient(
	chain: typeof mainnet,
	{
		aggregateHex = AGGREGATE_PUBKEY_HEX,
		burnBlockHeight = SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET - 1,
	}: { aggregateHex?: string; burnBlockHeight?: number } = {},
): Client & { paths: string[] } {
	const paths: string[] = [];
	const request = async (path: string) => {
		paths.push(path);
		if (path.endsWith("/get-current-aggregate-pubkey")) {
			return { okay: true, result: `0x${buff33Result(aggregateHex)}` };
		}
		if (path.endsWith("/get-current-signer-data")) {
			return { okay: true, result: `0x${signerDataResult(aggregateHex)}` };
		}
		if (path === "/v2/info") return { burn_block_height: burnBlockHeight };
		throw new Error(`unexpected path ${path}`);
	};
	const client = createPublicClient({
		chain,
		transport: custom({ request }),
	}) as unknown as Client;
	return Object.assign(client, { paths });
}

describe("sbtc signers", () => {
	it("reads the aggregate pubkey from the registry", async () => {
		const pubkey = await getSignersPublicKey(registryClient(mainnet));
		expect(Buffer.from(pubkey).toString("hex")).toBe(AGGREGATE_PUBKEY_HEX);
	});

	it("reads the signer set and threshold", async () => {
		const set = await getSignerSet(registryClient(mainnet));
		expect(
			set.signerPublicKeys.map((k) => Buffer.from(k).toString("hex")),
		).toEqual(DEVENV_SIGNER_KEYS);
		expect(set.signaturesRequired).toBe(2);
		expect(set.signerPrincipal).toBe(
			"SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8",
		);
	});

	it("derives the live mainnet v1 address before activation (unchanged)", async () => {
		expect(await getSignersAddress(registryClient(mainnet))).toBe(
			SIGNERS_ADDRESS_MAINNET,
		);
		expect(
			await getSignersAddress(registryClient(mainnet), { version: "v1" }),
		).toBe(SIGNERS_ADDRESS_MAINNET);
	});

	it("switches to the v2 multi_a peg at the activation height", async () => {
		const client = registryClient(mainnet, {
			burnBlockHeight: SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET,
		});
		const expected = deriveSbtcV2PegOutput(
			DEVENV_SIGNER_KEYS.map(hexToBytes),
			2,
		).address;
		const address = await getSignersAddress(client);
		expect(address).toBe(expected);
		expect(address).not.toBe(SIGNERS_ADDRESS_MAINNET);
		// v2 never reads the aggregate key.
		expect(
			client.paths.some((p) => p.endsWith("/get-current-aggregate-pubkey")),
		).toBe(false);
	});

	it("resolves the version at an explicit height without reading the tip", async () => {
		const client = registryClient(mainnet);
		await getSignersAddress(client, {
			burnBlockHeight: SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET + 10,
		});
		expect(client.paths).not.toContain("/v2/info");
		expect(
			client.paths.some((p) => p.endsWith("/get-current-signer-data")),
		).toBe(true);
	});

	it("derives v2 when the registry holds the 0xFF marker", async () => {
		const client = registryClient(mainnet, {
			aggregateHex: V2_MARKER_HEX,
			burnBlockHeight: SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET,
		});
		expect(await getSignersAddress(client)).toBe(
			deriveSbtcV2PegOutput(DEVENV_SIGNER_KEYS.map(hexToBytes), 2).address,
		);
		const set = await getSignerSet(client);
		expect(
			deriveSbtcV2PegOutput(set.signerPublicKeys, set.signaturesRequired)
				.scriptPubKey,
		).toEqual(hexToBytes(`5120${DEVENV_V2_OUTPUT_KEY}`));
	});

	it("never derives a v1 address from the 0xFF marker", async () => {
		const client = registryClient(mainnet, { aggregateHex: V2_MARKER_HEX });
		await expect(getSignersPublicKey(client)).rejects.toBeInstanceOf(
			SbtcV2MarkerError,
		);
		await expect(
			getSignersAddress(client, { version: "v1" }),
		).rejects.toBeInstanceOf(SbtcV2MarkerError);
	});

	it("encodes testnet with tb1p — the upstream regtest-hardcode regression", async () => {
		const client = registryClient(testnet);
		expect(
			(await getSignersAddress(client, { version: "v1" })).startsWith("tb1p"),
		).toBe(true);
		expect(
			(await getSignersAddress(client, { version: "v2" })).startsWith("tb1p"),
		).toBe(true);
	});

	it("encodes devnet with bcrt1p (regtest)", async () => {
		const address = await getSignersAddress(registryClient(devnet), {
			version: "v1",
		});
		expect(address.startsWith("bcrt1p")).toBe(true);
	});

	it("needs a version or activation height off mainnet", async () => {
		await expect(getSignersAddress(registryClient(testnet))).rejects.toThrow(
			/no fixed activation height/,
		);
		const client = registryClient(testnet, { burnBlockHeight: 300 });
		expect(
			await getSignersAddress(client, { v2ActivationBurnHeight: 245 }),
		).toBe(await getSignersAddress(client, { version: "v2" }));
	});

	it("throws a descriptive error on an all-zero pubkey", async () => {
		await expect(
			getSignersPublicKey(
				registryClient(mainnet, { aggregateHex: "00".repeat(33) }),
			),
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
