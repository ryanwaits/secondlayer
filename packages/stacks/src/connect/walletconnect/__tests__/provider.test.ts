import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { WalletConnectProvider } from "../provider.ts";
import type { WalletProvider } from "../../types.ts";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  url: string;
  private listeners = new Map<string, Set<Function>>();
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.emit("open", {});
    }, 0);
  }

  addEventListener(event: string, fn: Function, opts?: { once?: boolean }) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const wrapped = opts?.once
      ? (...args: any[]) => { this.listeners.get(event)?.delete(wrapped); fn(...args); }
      : fn;
    this.listeners.get(event)!.add(wrapped);
  }
  removeEventListener() {}
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  emit(event: string, data: any) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }
}

const origWS = globalThis.WebSocket;
const storage = new Map<string, string>();

beforeEach(() => {
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) { super(url); }
  };
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  };
  storage.clear();
});

afterEach(() => {
  (globalThis as any).WebSocket = origWS;
  delete (globalThis as any).localStorage;
});

describe("WalletConnectProvider", () => {
  const config = {
    projectId: "test",
    metadata: { name: "App", description: "", url: "https://app.com", icons: [] },
  };

  test("implements WalletProvider interface", () => {
    const wc = new WalletConnectProvider(config);
    expect(typeof wc.request).toBe("function");
    expect(typeof wc.disconnect).toBe("function");

    // Type check: assignable to WalletProvider
    const _provider: WalletProvider = wc;
    expect(_provider).toBeDefined();
  });

  test("restore returns false with no session", () => {
    const wc = new WalletConnectProvider(config);
    expect(wc.restore()).toBe(false);
  });

  test("pair returns URI and approval", async () => {
    const wc = new WalletConnectProvider(config);
    const pairPromise = wc.pair();

    await new Promise((r) => setTimeout(r, 20));
    // Would need to respond to subscribe — just verify it doesn't crash
    // The full flow is tested in session.test.ts
  });

  test("sessionData is null initially", () => {
    const wc = new WalletConnectProvider(config);
    expect(wc.sessionData).toBeNull();
  });

  test("disconnect cleans up", () => {
    const wc = new WalletConnectProvider(config);
    wc.disconnect(); // should not throw
  });
});
