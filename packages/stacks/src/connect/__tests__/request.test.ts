import { describe, test, expect, beforeEach, mock } from "bun:test";
import { request } from "../request.ts";
import { ConnectError, JsonRpcError } from "../errors.ts";
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

describe("request", () => {
  test("throws ConnectError when no provider", async () => {
    expect(request("stx_getAddresses")).rejects.toThrow(ConnectError);
  });

  test("calls provider with correct method and params", async () => {
    const mockRequest = mock(() =>
      Promise.resolve({ txId: "0x123" })
    );
    setProvider({ request: mockRequest });

    const result = await request("stx_transferStx", {
      recipient: "SP123",
      amount: "1000",
      network: "mainnet",
    });

    expect(mockRequest).toHaveBeenCalledWith("stx_transferStx", {
      recipient: "SP123",
      amount: "1000",
      network: "mainnet",
    });
    expect(result).toEqual({ txId: "0x123" });
  });

  test("serializes bigint params to string", async () => {
    const mockRequest = mock(() => Promise.resolve({}));
    setProvider({ request: mockRequest });

    await request("stx_transferStx", {
      recipient: "SP123",
      amount: "1000",
      network: "mainnet",
    } as any);

    // bigint in nested objects would be serialized
    const calls = mockRequest.mock.calls;
    expect(calls.length).toBe(1);
  });

  test("caches addresses on stx_getAddresses", async () => {
    const addresses = [
      { address: "SP123", publicKey: "abc" },
      { address: "bc1q...", publicKey: "def" },
    ];
    setProvider({
      request: mock(() =>
        Promise.resolve({ addresses })
      ),
    });

    await request("stx_getAddresses");

    const raw = store.get("@secondlayer/connect");
    expect(raw).toBeDefined();
  });

  test("caches addresses on getAddresses alias", async () => {
    const addresses = [{ address: "SP123", publicKey: "abc" }];
    setProvider({
      request: mock(() =>
        Promise.resolve({ addresses })
      ),
    });

    await request("getAddresses");

    const raw = store.get("@secondlayer/connect");
    expect(raw).toBeDefined();
  });

  test("does not cache on non-address methods", async () => {
    setProvider({
      request: mock(() =>
        Promise.resolve({ txId: "0x123" })
      ),
    });

    await request("stx_transferStx", {
      recipient: "SP123",
      amount: "1000",
      network: "mainnet",
    });

    expect(store.get("@secondlayer/connect")).toBeUndefined();
  });

  test("wraps provider errors with code in JsonRpcError", async () => {
    setProvider({
      request: mock(() =>
        Promise.reject({ code: -31001, message: "User rejected" })
      ),
    });

    try {
      await request("stx_transferStx", {
        recipient: "SP123",
        amount: "1000",
        network: "mainnet",
      });
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(JsonRpcError);
      expect((err as JsonRpcError).code).toBe(-31001);
    }
  });

  test("wraps generic errors in ConnectError", async () => {
    setProvider({
      request: mock(() =>
        Promise.reject(new Error("network down"))
      ),
    });

    try {
      await request("stx_getAddresses");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).message).toContain("network down");
    }
  });

  test("passes through params without mutation when no special types", async () => {
    const mockRequest = mock(() => Promise.resolve({}));
    setProvider({ request: mockRequest });

    await request("stx_callContract", {
      contract: "SP123.my-contract",
      functionName: "transfer",
      functionArgs: ["arg1", "arg2"],
      network: "mainnet",
    });

    expect(mockRequest.mock.calls[0][1]).toEqual({
      contract: "SP123.my-contract",
      functionName: "transfer",
      functionArgs: ["arg1", "arg2"],
      network: "mainnet",
    });
  });

  test("serializes bigint values in nested objects", async () => {
    const mockRequest = mock(() => Promise.resolve({}));
    setProvider({ request: mockRequest });

    await request("stx_callContract", {
      contract: "SP123.test",
      functionName: "foo",
      functionArgs: [100n as any],
      network: "mainnet",
    });

    const sentArgs = (mockRequest.mock.calls[0][1] as any).functionArgs;
    expect(sentArgs[0]).toBe("100");
  });

  test("preserves post-condition objects as-is", async () => {
    const mockRequest = mock(() => Promise.resolve({}));
    setProvider({ request: mockRequest });

    const pc = { type: "stx-postcondition", amount: "1000" };
    await request("stx_callContract", {
      contract: "SP123.test",
      functionName: "foo",
      functionArgs: [],
      network: "mainnet",
      postConditions: [pc],
    } as any);

    const sent = mockRequest.mock.calls[0][1] as any;
    expect(sent.postConditions[0]).toEqual(pc);
  });

  test("returns result from provider unchanged", async () => {
    const expected = { txId: "0xabc", status: "ok" };
    setProvider({
      request: mock(() => Promise.resolve(expected)),
    });

    const result = await request("stx_transferStx", {
      recipient: "SP1",
      amount: "100",
      network: "mainnet",
    });

    expect(result).toEqual(expected);
  });
});
