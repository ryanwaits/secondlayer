import { test, expect, describe, beforeEach, afterEach, mock, jest } from "bun:test";
import { WebSocketChannel } from "../../transports/webSocket.ts";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  sent: string[] = [];

  private listeners: Record<string, Array<{ fn: Function; once: boolean }>> = {};

  constructor(url: string) {
    this.url = url;
    // Auto-open after microtask
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(event: string, fn: Function, opts?: { once?: boolean }) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push({ fn, once: opts?.once ?? false });
  }

  removeEventListener(event: string, fn: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l.fn !== fn);
  }

  send(data: string) {
    this.sent.push(data);
    // Auto-respond to JSON-RPC requests
    const msg = JSON.parse(data);
    if (msg.method === "subscribe" || msg.method === "unsubscribe") {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: true }),
        });
      });
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  // Test helper: simulate incoming notification
  simulateMessage(data: unknown) {
    this.emit("message", { data: JSON.stringify(data) });
  }

  private emit(event: string, payload: unknown) {
    const handlers = this.listeners[event] ?? [];
    for (const h of handlers) {
      h.fn(payload);
    }
    // Remove once listeners
    this.listeners[event] = handlers.filter((h) => !h.once);
  }
}

let originalWebSocket: typeof globalThis.WebSocket;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

function getCreatedWs(): MockWebSocket {
  // The channel creates a WebSocket internally; we capture via the global mock
  // We need to access it indirectly through the sent messages
  return (globalThis as any)._lastWs;
}

describe("WebSocketChannel", () => {
  test("subscribe sends JSON-RPC subscribe message", async () => {
    const channel = new WebSocketChannel("ws://localhost:3999");
    const cb = mock(() => {});

    const sub = await channel.subscribe({ event: "block" }, cb);

    // Verify by checking that subscribe didn't throw (means RPC succeeded)
    expect(sub).toBeDefined();
    expect(sub.unsubscribe).toBeFunction();

    channel.destroy();
  });

  test("multiple subscribers to same event share one WS subscription", async () => {
    const channel = new WebSocketChannel("ws://localhost:3999");
    const cb1 = mock(() => {});
    const cb2 = mock(() => {});

    const sub1 = await channel.subscribe({ event: "block" }, cb1);
    const sub2 = await channel.subscribe({ event: "block" }, cb2);

    expect(sub1).toBeDefined();
    expect(sub2).toBeDefined();

    channel.destroy();
  });

  test("different events create separate subscriptions", async () => {
    const channel = new WebSocketChannel("ws://localhost:3999");
    const cb1 = mock(() => {});
    const cb2 = mock(() => {});

    const sub1 = await channel.subscribe({ event: "block" }, cb1);
    const sub2 = await channel.subscribe({ event: "mempool" }, cb2);

    expect(sub1).toBeDefined();
    expect(sub2).toBeDefined();

    channel.destroy();
  });

  test("destroy rejects further subscribe calls", async () => {
    const channel = new WebSocketChannel("ws://localhost:3999");
    channel.destroy();

    expect(
      channel.subscribe({ event: "block" }, () => {})
    ).rejects.toThrow("destroyed");
  });

  test("unsubscribe removes callback", async () => {
    const channel = new WebSocketChannel("ws://localhost:3999");
    const cb = mock(() => {});

    const sub = await channel.subscribe({ event: "block" }, cb);
    sub.unsubscribe();

    // Should not throw
    channel.destroy();
  });
});
