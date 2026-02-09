import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { WcSession } from "../session.ts";
import {
  generateKeyPair,
  generateSymKey,
  encryptType0,
  encodeBase64,
  bytesToHex,
  hexToBytes,
} from "../crypto.ts";

// -- Mock WebSocket with auto-RPC responder --
// Uses queueMicrotask instead of setTimeout for deterministic timing
class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  url: string;
  private listeners = new Map<string, Set<Function>>();
  sent: string[] = [];
  private respondedIds = new Set<number>();

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      if (this.readyState === 3) return; // already closed
      this.readyState = 1;
      this.emit("open", {});
    });
  }

  addEventListener(event: string, fn: Function, opts?: { once?: boolean }) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const wrapped = opts?.once
      ? (...args: any[]) => { this.listeners.get(event)?.delete(wrapped); fn(...args); }
      : fn;
    this.listeners.get(event)!.add(wrapped);
  }
  removeEventListener() {}
  send(data: string) {
    this.sent.push(data);
    // Auto-respond to RPC calls via microtask
    try {
      const rpc = JSON.parse(data);
      if (rpc.method && rpc.id != null && !this.respondedIds.has(rpc.id)) {
        this.respondedIds.add(rpc.id);
        const result = rpc.method === "irn_subscribe" ? `sub-${rpc.id}` : true;
        queueMicrotask(() => {
          if (this.readyState !== 1) return;
          this.simulateMessage(JSON.stringify({ id: rpc.id, jsonrpc: "2.0", result }));
        });
      }
    } catch {}
  }
  close() { this.readyState = 3; }
  emit(event: string, data: any) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }
  simulateMessage(data: string) { this.emit("message", { data }); }
}

let wsInstances: MockWebSocket[] = [];
const origWS = globalThis.WebSocket;

const storage = new Map<string, string>();
const mockStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
};

beforeEach(() => {
  wsInstances = [];
  storage.clear();
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) { super(url); wsInstances.push(this); }
  };
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).localStorage = mockStorage;
});

afterEach(() => {
  // Close all WS instances to prevent stale microtask callbacks
  for (const ws of wsInstances) ws.close();
  wsInstances = [];
  (globalThis as any).WebSocket = origWS;
  delete (globalThis as any).localStorage;
});

const TEST_CONFIG = {
  projectId: "test-pid",
  metadata: { name: "Test", description: "Test app", url: "https://test.com", icons: [] },
  chains: ["stacks:1"],
};

describe("WcSession", () => {
  test("pair() returns valid WC URI", async () => {
    const session = new WcSession(TEST_CONFIG);
    const { uri, approval } = await session.pair();
    expect(uri).toMatch(/^wc:[0-9a-f]{64}@2\?relay-protocol=irn&symKey=[0-9a-f]{64}$/);
    // Suppress unhandled rejection from approval when we disconnect
    approval.catch(() => {});
    session.disconnect();
  });

  test("full pairing → session flow", async () => {
    const session = new WcSession(TEST_CONFIG);
    const { uri, approval } = await session.pair();

    // Parse URI: wc:{topic}@2?relay-protocol=irn&symKey={hex}
    const [topicPart, queryPart] = uri.replace("wc:", "").split("@2?");
    const pairingTopic = topicPart;
    const params = new URLSearchParams(queryPart);
    const pairingSymKey = hexToBytes(params.get("symKey")!);

    // Allow the subscribe RPC to complete
    await new Promise((r) => setTimeout(r, 10));
    const ws = wsInstances[0];

    // Simulate wallet sending wc_sessionPropose
    const walletKp = generateKeyPair();
    const proposal = {
      id: 1001,
      jsonrpc: "2.0",
      method: "wc_sessionPropose",
      params: {
        id: 1001,
        proposer: {
          publicKey: bytesToHex(walletKp.publicKey),
          metadata: { name: "Wallet", description: "", url: "", icons: [] },
        },
        requiredNamespaces: {
          stacks: { chains: ["stacks:1"], methods: ["stx_getAddresses"], events: [] },
        },
      },
    };

    const encrypted = encryptType0(pairingSymKey, JSON.stringify(proposal));

    ws.simulateMessage(
      JSON.stringify({
        id: 5000,
        jsonrpc: "2.0",
        method: "irn_subscription",
        params: {
          id: "sub-pairing",
          data: { topic: pairingTopic, message: encodeBase64(encrypted), publishedAt: Date.now(), tag: 1100 },
        },
      }),
    );

    const settled = await approval;

    expect(settled.relay.protocol).toBe("irn");
    expect(settled.namespaces.stacks).toBeDefined();
    expect(settled.namespaces.stacks.methods).toContain("stx_getAddresses");
    expect(settled.namespaces.stacks.methods).toContain("stx_callContract");
    expect(settled.expiry).toBeGreaterThan(Date.now() / 1000);

    // Session persisted
    expect(storage.has("@secondlayer/wc:session")).toBe(true);

    session.disconnect();
  });

  test("restore returns false with no stored session", () => {
    const session = new WcSession(TEST_CONFIG);
    expect(session.restore()).toBe(false);
  });

  test("restore returns false with expired session", () => {
    storage.set(
      "@secondlayer/wc:session",
      JSON.stringify({
        topic: "abc",
        symKey: bytesToHex(generateSymKey()),
        peerMeta: { name: "", description: "", url: "", icons: [] },
        expiry: Math.floor(Date.now() / 1000) - 100,
        accounts: [],
        controllerPublicKey: "def",
      }),
    );
    const session = new WcSession(TEST_CONFIG);
    expect(session.restore()).toBe(false);
    expect(storage.has("@secondlayer/wc:session")).toBe(false);
  });

  test("restore returns true with valid session", () => {
    storage.set(
      "@secondlayer/wc:session",
      JSON.stringify({
        topic: "abc123",
        symKey: bytesToHex(generateSymKey()),
        peerMeta: { name: "", description: "", url: "", icons: [] },
        expiry: Math.floor(Date.now() / 1000) + 86400,
        accounts: [],
        controllerPublicKey: "def",
      }),
    );
    const session = new WcSession(TEST_CONFIG);
    expect(session.restore()).toBe(true);
    expect(session.session).not.toBeNull();
    expect(session.session!.topic).toBe("abc123");
    session.disconnect();
  });

  test("disconnect clears storage", () => {
    storage.set("@secondlayer/wc:session", "{}");
    const session = new WcSession(TEST_CONFIG);
    session.disconnect();
    expect(storage.has("@secondlayer/wc:session")).toBe(false);
  });

  test("request throws without active session", async () => {
    const session = new WcSession(TEST_CONFIG);
    await expect(session.request("stx_getAddresses")).rejects.toThrow("No active WC session");
  });
});
