import type { StacksProvider, ProviderAccount } from "./types.ts";

/** Create a ProviderAccount by querying the wallet for addresses */
export async function providerToAccount(
  provider: StacksProvider
): Promise<ProviderAccount> {
  const result = await provider.request("stx_getAddresses");

  const entry = result?.addresses?.[0];
  if (!entry?.address || !entry?.publicKey) {
    throw new Error("Provider did not return a valid address");
  }

  return {
    type: "provider",
    address: entry.address,
    publicKey: entry.publicKey,
    provider,
  };
}
