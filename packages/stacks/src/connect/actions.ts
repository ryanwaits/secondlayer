import type { AddressesResult } from "./types.ts";
import { request } from "./request.ts";
import { getProvider } from "./provider.ts";
import { clearStorage, getStorageData } from "./storage.ts";

export async function connect(options?: {
  network?: string;
}): Promise<AddressesResult> {
  return request("getAddresses");
}

export function disconnect(): void {
  clearStorage();
  try {
    getProvider().disconnect?.();
  } catch {
    // provider may not exist — that's fine
  }
}

export function isConnected(): boolean {
  const data = getStorageData();
  return (data?.addresses?.stx?.length ?? 0) > 0;
}
