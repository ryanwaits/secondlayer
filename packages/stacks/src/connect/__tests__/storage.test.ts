import { describe, test, expect, beforeEach } from "bun:test";
import {
  getStorageData,
  setStorageData,
  clearStorage,
  cacheAddresses,
  type StorageData,
} from "../storage.ts";

// Mock localStorage
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
};

beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = mockLocalStorage;
});

describe("storage", () => {
  test("returns null when empty", () => {
    expect(getStorageData()).toBeNull();
  });

  test("roundtrip set/get", () => {
    const data: StorageData = {
      addresses: {
        stx: [{ address: "SP123", publicKey: "abc" }],
        btc: [],
      },
      version: "0.0.1",
      updatedAt: 1000,
    };
    setStorageData(data);
    expect(getStorageData()).toEqual(data);
  });

  test("clearStorage removes data", () => {
    setStorageData({
      addresses: { stx: [], btc: [] },
      version: "0.0.1",
      updatedAt: 1,
    });
    clearStorage();
    expect(getStorageData()).toBeNull();
  });

  test("hex encoding is used in localStorage", () => {
    setStorageData({
      addresses: { stx: [], btc: [] },
      version: "0.0.1",
      updatedAt: 1,
    });
    const raw = store.get("@secondlayer/connect")!;
    // hex-encoded — should not contain '{' directly
    expect(raw).not.toContain("{");
    expect(/^[0-9a-f]+$/.test(raw)).toBe(true);
  });

  test("returns null on malformed data", () => {
    store.set("@secondlayer/connect", "not-hex!!!");
    expect(getStorageData()).toBeNull();
  });

  test("returns null on invalid JSON hex", () => {
    // hex-encode something that's not valid JSON
    const badHex = Array.from(new TextEncoder().encode("not json"))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    store.set("@secondlayer/connect", badHex);
    expect(getStorageData()).toBeNull();
  });

  test("cacheAddresses separates stx and btc", () => {
    cacheAddresses([
      { address: "SP123", publicKey: "a" },
      { address: "ST456", publicKey: "b" },
      { address: "bc1q...", publicKey: "c" },
    ]);
    const data = getStorageData()!;
    expect(data.addresses.stx).toHaveLength(2);
    expect(data.addresses.btc).toHaveLength(1);
    expect(data.version).toBe("0.0.1");
    expect(data.updatedAt).toBeGreaterThan(0);
  });

  test("cacheAddresses overwrites previous data", () => {
    cacheAddresses([{ address: "SP1", publicKey: "x" }]);
    cacheAddresses([{ address: "SP2", publicKey: "y" }]);
    const data = getStorageData()!;
    expect(data.addresses.stx).toHaveLength(1);
    expect(data.addresses.stx[0].address).toBe("SP2");
  });
});
