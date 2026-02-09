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

let customProvider: WalletProvider | null = null;

/** Set a custom provider (e.g. WalletConnectProvider). Pass null to clear. */
export function setProvider(provider: WalletProvider | null): void {
  customProvider = provider;
}

export function getProvider(): WalletProvider {
  if (customProvider) return customProvider;

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
