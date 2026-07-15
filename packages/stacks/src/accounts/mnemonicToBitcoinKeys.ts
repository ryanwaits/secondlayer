import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import {
	publicKeyToP2trAddress,
	publicKeyToP2wpkhAddress,
} from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import { bytesToHex } from "../utils/encoding.ts";

export type BitcoinKeyType = "p2wpkh" | "p2tr";

export type MnemonicToBitcoinKeysOptions = {
	/** `'p2wpkh'` (BIP84, `bc1q…`) or `'p2tr'` (BIP86, `bc1p…`). */
	type: BitcoinKeyType;
	network?: BitcoinNetwork;
	accountIndex?: number;
	/** 0 = receive chain, 1 = change chain. */
	changeIndex?: number;
	addressIndex?: number;
};

export type BitcoinKeys = {
	/** 32-byte private key, hex. */
	privateKey: string;
	/** 33-byte compressed public key, hex. */
	publicKey: string;
	address: string;
	/** Full BIP84/BIP86 derivation path. */
	path: string;
};

const PURPOSE: Record<BitcoinKeyType, number> = { p2wpkh: 84, p2tr: 86 };

/**
 * Derive Bitcoin keys + address from the same mnemonic that backs a Stacks
 * account — BIP84 (native segwit) or BIP86 (taproot) paths, matching what
 * Leather/Xverse derive for the paired BTC account. Pure derivation: no
 * Bitcoin transaction building or signing.
 *
 * @example
 * const btc = mnemonicToBitcoinKeys(mnemonic, { type: "p2tr" });
 * btc.address; // bc1p…
 * btc.path;    // m/86'/0'/0'/0/0
 */
export function mnemonicToBitcoinKeys(
	mnemonic: string,
	options: MnemonicToBitcoinKeysOptions,
): BitcoinKeys {
	const {
		type,
		network = "mainnet",
		accountIndex = 0,
		changeIndex = 0,
		addressIndex = 0,
	} = options;

	// BIP44 coin type: 0' mainnet, 1' testnet/regtest.
	const coinType = network === "mainnet" ? 0 : 1;
	const path = `m/${PURPOSE[type]}'/${coinType}'/${accountIndex}'/${changeIndex}/${addressIndex}`;

	const seed = mnemonicToSeedSync(mnemonic);
	const child = HDKey.fromMasterSeed(seed).derive(path);
	if (!child.privateKey || !child.publicKey)
		throw new Error("Failed to derive Bitcoin key");

	const address =
		type === "p2wpkh"
			? publicKeyToP2wpkhAddress(child.publicKey, network)
			: publicKeyToP2trAddress(child.publicKey, network);

	return {
		privateKey: bytesToHex(child.privateKey),
		publicKey: bytesToHex(child.publicKey),
		address,
		path,
	};
}
