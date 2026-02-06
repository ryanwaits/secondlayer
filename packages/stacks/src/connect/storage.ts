import type { AddressEntry } from "./types.ts";

const STORAGE_KEY = "@secondlayer/connect";

export interface StorageData {
  addresses: {
    stx: AddressEntry[];
    btc: AddressEntry[];
  };
  version: string;
  updatedAt: number;
}

function toHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): string {
  const bytes = new Uint8Array(
    hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );
  return new TextDecoder().decode(bytes);
}

interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

declare const localStorage: SimpleStorage | undefined;

function getLocalStorage(): SimpleStorage | undefined {
  return typeof localStorage !== "undefined" ? localStorage : undefined;
}

export function getStorageData(): StorageData | null {
  try {
    const raw = getLocalStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(fromHex(raw)) as StorageData;
  } catch {
    return null;
  }
}

export function setStorageData(data: StorageData): void {
  const encoded = toHex(JSON.stringify(data));
  getLocalStorage()?.setItem(STORAGE_KEY, encoded);
}

export function clearStorage(): void {
  getLocalStorage()?.removeItem(STORAGE_KEY);
}

export function cacheAddresses(addresses: AddressEntry[]): void {
  const stx = addresses.filter(
    (a) => a.address.startsWith("SP") || a.address.startsWith("ST")
  );
  const btc = addresses.filter(
    (a) => !a.address.startsWith("SP") && !a.address.startsWith("ST")
  );

  setStorageData({
    addresses: { stx, btc },
    version: "0.0.1",
    updatedAt: Date.now(),
  });
}
