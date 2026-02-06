import { describe, test, expect, beforeEach, mock } from "bun:test";
import { connect, disconnect, isConnected } from "../actions.ts";
import { setStorageData, clearStorage, getStorageData } from "../storage.ts";
import type { WalletProvider } from "../types.ts";

// Mock localStorage
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
};

function setProvider(provider: WalletProvider) {
  (globalThis as any).window = { StacksProvider: provider };
}

function clearProvider() {
  (globalThis as any).window = {};
}

beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = mockLocalStorage;
  clearProvider();
});

describe("connect", () => {
  test("calls getAddresses on provider", async () => {
    const mockRequest = mock(() =>
      Promise.resolve({
        addresses: [{ address: "SP123", publicKey: "abc" }],
      })
    );
    setProvider({ request: mockRequest });

    const result = await connect();
    expect(mockRequest).toHaveBeenCalledWith("getAddresses", undefined);
    expect(result.addresses).toHaveLength(1);
  });

  test("caches addresses after connect", async () => {
    setProvider({
      request: mock(() =>
        Promise.resolve({
          addresses: [{ address: "SP123", publicKey: "abc" }],
        })
      ),
    });

    await connect();
    expect(isConnected()).toBe(true);
  });
});

describe("disconnect", () => {
  test("clears storage", () => {
    setStorageData({
      addresses: {
        stx: [{ address: "SP123", publicKey: "abc" }],
        btc: [],
      },
      version: "0.0.1",
      updatedAt: 1,
    });

    setProvider({ request: mock(() => Promise.resolve()) });
    disconnect();

    expect(getStorageData()).toBeNull();
  });

  test("calls provider.disconnect if available", () => {
    const mockDisconnect = mock(() => {});
    setProvider({
      request: mock(() => Promise.resolve()),
      disconnect: mockDisconnect,
    });

    disconnect();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  test("does not throw if no provider", () => {
    setStorageData({
      addresses: { stx: [{ address: "SP1", publicKey: "x" }], btc: [] },
      version: "0.0.1",
      updatedAt: 1,
    });

    // no provider set
    expect(() => disconnect()).not.toThrow();
    expect(getStorageData()).toBeNull();
  });
});

describe("isConnected", () => {
  test("returns false when no storage", () => {
    expect(isConnected()).toBe(false);
  });

  test("returns false when stx addresses empty", () => {
    setStorageData({
      addresses: { stx: [], btc: [{ address: "bc1q", publicKey: "x" }] },
      version: "0.0.1",
      updatedAt: 1,
    });
    expect(isConnected()).toBe(false);
  });

  test("returns true when stx addresses present", () => {
    setStorageData({
      addresses: {
        stx: [{ address: "SP123", publicKey: "abc" }],
        btc: [],
      },
      version: "0.0.1",
      updatedAt: 1,
    });
    expect(isConnected()).toBe(true);
  });
});
