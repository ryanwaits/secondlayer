import type { NetworkName } from "../types/config";

export function inferNetwork(address: string): NetworkName | undefined {
  if (address.startsWith("SP") || address.startsWith("SM")) return "mainnet";
  if (address.startsWith("ST") || address.startsWith("SN")) return "testnet";
  return undefined;
}
