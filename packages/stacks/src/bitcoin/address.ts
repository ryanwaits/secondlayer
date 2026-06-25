import { base58, bech32, bech32m } from "@scure/base";
import { concatBytes } from "../utils/encoding.ts";
import type { ParsedOutputScript } from "./codec.ts";
import type { BitcoinNetwork } from "./constants.ts";
import { doubleSha256 } from "./serialize.ts";

const NETWORK_PARAMS = {
	mainnet: { p2pkh: 0x00, p2sh: 0x05, hrp: "bc" },
	testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "tb" },
} as const;

/** Base58Check-encode a versioned 20-byte payload (legacy P2PKH / P2SH). */
function base58Check(version: number, payload: Uint8Array): string {
	const data = concatBytes(Uint8Array.of(version), payload);
	const checksum = doubleSha256(data).slice(0, 4);
	return base58.encode(concatBytes(data, checksum));
}

/**
 * Render a parsed output script as a Bitcoin address for the given network.
 * Returns `undefined` for scripts without a standard address (OP_RETURN, P2PK,
 * unknown). Address encoding is network-dependent, which is why this is separate
 * from the pure `parseOutputScript` decoder.
 */
export function formatBitcoinAddress(
	parsed: ParsedOutputScript,
	network: BitcoinNetwork = "mainnet",
): string | undefined {
	const params = NETWORK_PARAMS[network];
	const hash = parsed.hash;
	if (!hash) return undefined;
	switch (parsed.type) {
		case "p2pkh":
			return base58Check(params.p2pkh, hash);
		case "p2sh":
			return base58Check(params.p2sh, hash);
		case "p2wpkh":
		case "p2wsh":
			return bech32.encode(params.hrp, [0, ...bech32.toWords(hash)]);
		case "p2tr":
			return bech32m.encode(params.hrp, [1, ...bech32m.toWords(hash)]);
		default:
			return undefined;
	}
}
