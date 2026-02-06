import type { WalletProvider } from "./types.ts";
import { ConnectError } from "./errors.ts";

declare const window: { StacksProvider?: WalletProvider } | undefined;

export function getProvider(): WalletProvider {
  const p =
    typeof window !== "undefined" ? window.StacksProvider : undefined;
  if (!p) throw new ConnectError("No Stacks wallet found");
  return p;
}

export function isWalletInstalled(): boolean {
  return typeof window !== "undefined" && !!window.StacksProvider;
}
