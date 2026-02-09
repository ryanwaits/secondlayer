import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { WcRelay } from "../relay.ts";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  url: string;
  private listeners = new Map<string, Set<Function>>();
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Auto-open on next tick
    setTimeout(() => {
      this.readyState = 1;
      this.emit("open", {});
    }, 0);
  }

  addEventListener(event: string, fn: Function, opts?: { once?: boolean }) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const wrapped = opts?.once
      ? (...args: any[]) => {
          this.listeners.get(event)?.delete(wrapped);
          fn(...args);
        }
      : fn;
    this.listeners.get(event)!.add(wrapped);
  }

  removeEventListener(event: string, fn: Function) {
    this.listeners.get(event)?.delete(fn);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  // Test helpers
  emit(event: string, data: any) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }

  simulateMessage(data: string) {
    this.emit("message", { data });
  }
}

let wsInstances: MockWebSocket[] = [];
const origWebSocket = globalThis.WebSocket;

beforeEach(() => {
  wsInstances = [];
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      wsInstances.push(this);
    }
  };
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).WebSocket.CONNECTING = 0;
});

afterEach(() => {
  (globalThis as any).WebSocket = origWebSocket;
});

describe("WcRelay", () => {
  test("connects with projectId", async () => {
    const relay = new WcRelay("test-project-id");
    await relay.connect();
    expect(wsInstances.length).toBe(1);
    expect(wsInstances[0].url).toContain("projectId=test-project-id");
    relay.destroy();
  });

  test("subscribe sends irn_subscribe RPC", async () => {
    const relay = new WcRelay("pid");
    const handler = mock(() => {});

    // Start subscribe — it will connect first
    const subPromise = relay.subscribe("test-topic", handler);

    // Wait for connection
    await new Promise((r) => setTimeout(r, 10));

    const ws = wsInstances[0];
    expect(ws.sent.length).toBe(1);

    const rpc = JSON.parse(ws.sent[0]);
    expect(rpc.method).toBe("irn_subscribe");
    expect(rpc.params.topic).toBe("test-topic");

    // Respond with subscription ID
    ws.simulateMessage(
      JSON.stringify({ id: rpc.id, jsonrpc: "2.0", result: "sub-id-123" }),
    );

    const subId = await subPromise;
    expect(subId).toBe("sub-id-123");

    relay.destroy();
  });

  test("publish sends irn_publish RPC", async () => {
    const relay = new WcRelay("pid");
    await relay.connect();

    const ws = wsInstances[0];

    const pubPromise = relay.publish("topic-1", "base64msg", 1100, 300);

    await new Promise((r) => setTimeout(r, 5));

    const rpc = JSON.parse(ws.sent[0]);
    expect(rpc.method).toBe("irn_publish");
    expect(rpc.params.topic).toBe("topic-1");
    expect(rpc.params.message).toBe("base64msg");
    expect(rpc.params.tag).toBe(1100);
    expect(rpc.params.ttl).toBe(300);

    ws.simulateMessage(
      JSON.stringify({ id: rpc.id, jsonrpc: "2.0", result: true }),
    );

    await pubPromise;
    relay.destroy();
  });

  test("subscription handler receives server push", async () => {
    const relay = new WcRelay("pid");
    const received: any[] = [];

    const subPromise = relay.subscribe("my-topic", (msg) => received.push(msg));
    await new Promise((r) => setTimeout(r, 10));

    const ws = wsInstances[0];

    // Respond to subscribe
    const subRpc = JSON.parse(ws.sent[0]);
    ws.simulateMessage(
      JSON.stringify({ id: subRpc.id, jsonrpc: "2.0", result: "sub-42" }),
    );
    await subPromise;

    // Server pushes a message
    ws.simulateMessage(
      JSON.stringify({
        id: 999,
        jsonrpc: "2.0",
        method: "irn_subscription",
        params: {
          id: "sub-42",
          data: {
            topic: "my-topic",
            message: "encrypted-payload",
            publishedAt: 1700000000,
            tag: 1100,
          },
        },
      }),
    );

    expect(received.length).toBe(1);
    expect(received[0].topic).toBe("my-topic");
    expect(received[0].message).toBe("encrypted-payload");
    expect(received[0].tag).toBe(1100);

    // Should acknowledge
    const ack = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(ack.id).toBe(999);
    expect(ack.result).toBe(true);

    relay.destroy();
  });

  test("destroy cleans up", async () => {
    const relay = new WcRelay("pid");
    await relay.connect();
    relay.destroy();
    expect(wsInstances[0].readyState).toBe(3); // CLOSED
  });

  test("RPC error rejects promise", async () => {
    const relay = new WcRelay("pid");
    await relay.connect();

    const ws = wsInstances[0];
    const subPromise = relay.subscribe("topic", () => {});

    await new Promise((r) => setTimeout(r, 5));

    const rpc = JSON.parse(ws.sent[0]);
    ws.simulateMessage(
      JSON.stringify({
        id: rpc.id,
        jsonrpc: "2.0",
        error: { code: -1, message: "topic not found" },
      }),
    );

    await expect(subPromise).rejects.toThrow("topic not found");
    relay.destroy();
  });
});
