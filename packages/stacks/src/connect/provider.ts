import type { WalletProvider } from "./types.ts";
import { ConnectError } from "./errors.ts";

declare const window:
  | {
      StacksProvider?: WalletProvider;
      LeatherProvider?: WalletProvider;
      XverseProvider?: WalletProvider;
      HiroWalletProvider?: WalletProvider;
    }
  | undefined;

export function getProvider(): WalletProvider {
  if (typeof window === "undefined") {
    throw new ConnectError("No Stacks wallet found");
  }

  const provider =
    window.StacksProvider ??
    window.LeatherProvider ??
    window.XverseProvider ??
    window.HiroWalletProvider;

  if (!provider) throw new ConnectError("No Stacks wallet found");
  return provider;
}

export function isWalletInstalled(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(
      window.StacksProvider ||
      window.LeatherProvider ||
      window.XverseProvider ||
      window.HiroWalletProvider
    )
  );
}
