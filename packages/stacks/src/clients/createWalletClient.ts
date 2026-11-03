import type { StacksChain } from "../chains/types.ts";
import { c32address, c32addressDecode } from "../utils/c32.ts";
import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import { hash160 } from "../utils/hash.ts";
import { createClient } from "./createClient.ts";
import { type WalletActions, walletActions } from "./decorators/wallet.ts";
import type { Account, Client, ClientConfig } from "./types.ts";

/** Configuration for {@link createWalletClient} — requires an account for signing. */
export type WalletClientConfig = ClientConfig & {
	account: Account;
};

/**
 * Give an account derived from a local key the single-sig address for `chain`.
 *
 * `privateKeyToAccount` defaults to mainnet (`SP…`), but a node on testnet or
 * devnet checks nonces and signatures against the `ST…` address of the same
 * key. Provider accounts keep the wallet's address, and addresses that are not
 * this key's single-sig (multi-sig, contract) are left alone. Returns the same
 * object when nothing changes.
 */
export function alignAccountToChain(
	account: Account,
	chain: StacksChain | undefined,
): Account {
	if (!chain || account.type === "provider") return account;
	try {
		const [version, hash] = c32addressDecode(account.address);
		const keyHash = bytesToHex(hash160(hexToBytes(account.publicKey)));
		if (hash !== keyHash) return account;
		const target = chain.addressVersion.singleSig;
		if (version === target) return account;
		return { ...account, address: c32address(target, hash) };
	} catch {
		return account;
	}
}

/**
 * Create a client pre-extended with {@link WalletActions} for signing and broadcasting transactions.
 *
 * An account from a local key gets the address for the client's chain, so
 * `privateKeyToAccount(key)` works on testnet and devnet without
 * `addressVersion`. Provider accounts keep the wallet's address.
 */
export function createWalletClient(
	config: WalletClientConfig,
): Client<WalletActions> & WalletActions & { account: Account } {
	return createClient({
		...config,
		account: alignAccountToChain(config.account, config.chain),
		// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	}).extend(walletActions) as any;
}
