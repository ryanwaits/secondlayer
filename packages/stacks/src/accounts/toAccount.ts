import type { AccountSource, CustomAccount } from "./types.ts";

export function toAccount(source: AccountSource): CustomAccount {
  return {
    type: "custom",
    address: source.address,
    publicKey: source.publicKey,
    sign: source.sign,
  };
}
