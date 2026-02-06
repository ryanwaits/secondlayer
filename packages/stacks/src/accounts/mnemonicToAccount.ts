import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { bytesToHex } from "../utils/encoding.ts";
import { privateKeyToAccount, compressPrivateKey } from "./privateKeyToAccount.ts";
import type { LocalAccount } from "./types.ts";

const STX_DERIVATION_PATH = "m/44'/5757'/0'/0";

export function mnemonicToAccount(
  mnemonic: string,
  options?: {
    accountIndex?: number;
    addressVersion?: number;
  }
): LocalAccount {
  const { accountIndex = 0, addressVersion } = options ?? {};

  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`${STX_DERIVATION_PATH}/${accountIndex}`);

  if (!child.privateKey) throw new Error("Failed to derive private key");

  const privateKeyHex = compressPrivateKey(bytesToHex(child.privateKey));
  return privateKeyToAccount(privateKeyHex, { addressVersion });
}
