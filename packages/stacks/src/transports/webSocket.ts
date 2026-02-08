import type { StacksChain } from "../chains/types.ts";
import type { Transport, TransportConfig, TransportFactory } from "./types.ts";
import type { Subscription, WsSubscribeParams } from "../subscriptions/types.ts";
import { buildRequestFn } from "./createTransport.ts";
import { WebSocketError } from "../errors/websocket.ts";

export type WebSocketTransportConfig = TransportConfig & {
  /** WebSocket URL (resolved from chain if omitted) */
  url?: string;
  /** Enable auto-reconnect (default: true) */
  reconnect?: boolean;
  /** Max reconnect attempts (default: 10) */
  reconnectMaxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  reconnectBaseDelay?: number;
};

export type WebSocketTransport = Transport & {
  type: "webSocket";
  subscribe: (
    params: WsSubscribeParams,
    callback: (data: any) => void
  ) => Promise<Subscription>;
  destroy: () => void;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
};

type SubEntry = {
  params: WsSubscribeParams;
  callbacks: Set<(data: any) => void>;
};

function subKey(params: WsSubscribeParams): string {
  const parts: string[] = [params.event];
  if (params.tx_id) parts.push(`tx_id:${params.tx_id}`);
  if (params.address) parts.push(`address:${params.address}`);
  if (params.asset_identifier)
    parts.push(`asset:${params.asset_identifier}`);
  if (params.value) parts.push(`value:${params.value}`);
  return parts.join("|");
}

export class WebSocketChannel {
  private ws: WebSocket | null = null;
  private url: string;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private subs = new Map<string, SubEntry>();
  private destroyed = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnect: boolean;
  private reconnectMaxAttempts: number;
  private reconnectBaseDelay: number;

  constructor(url: string, config?: WebSocketTransportConfig) {
    this.url = url;
    this.reconnect = config?.reconnect ?? true;
    this.reconnectMaxAttempts = config?.reconnectMaxAttempts ?? 10;
    this.reconnectBaseDelay = config?.reconnectBaseDelay ?? 1000;
  }

  private connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const onOpen = () => {
          this.ws?.removeEventListener("error", onError);
          resolve();
        };
        const onError = (e: Event) => {
          this.ws?.removeEventListener("open", onOpen);
          reject(
            new WebSocketError("WebSocket connection failed", {
              details: String(e),
            })
          );
        };
        this.ws!.addEventListener("open", onOpen, { once: true });
        this.ws!.addEventListener("error", onError, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener(
        "open",
        () => {
          this.reconnectAttempt = 0;
          this.reconnecting = false;
          resolve();
        },
        { once: true }
      );

      this.ws.addEventListener(
        "error",
        (e) => {
          reject(
            new WebSocketError("WebSocket connection failed", {
              details: String(e),
            })
          );
        },
        { once: true }
      );

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      this.ws.addEventListener("close", () => {
        if (!this.destroyed) this.handleDisconnect();
      });
    });
  }

  private handleMessage(raw: string | ArrayBuffer | Blob) {
    const data =
      typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);

    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // RPC response
    if ("id" in msg && msg.id != null) {
      const rpc = msg as JsonRpcResponse;
      const p = this.pending.get(rpc.id);
      if (!p) return;
      this.pending.delete(rpc.id);
      if (rpc.error) {
        p.reject(
          new WebSocketError(rpc.error.message, {
            details: `JSON-RPC error ${rpc.error.code}`,
          })
        );
      } else {
        p.resolve(rpc.result);
      }
      return;
    }

    // Notification
    const notif = msg as JsonRpcNotification;
    if (!notif.method) return;

    for (const [, entry] of this.subs) {
      if (entry.params.event === notif.method) {
        for (const cb of entry.callbacks) {
          try {
            cb(notif.params);
          } catch {
            // subscriber error — don't crash channel
          }
        }
      }
    }
  }

  private handleDisconnect() {
    this.ws = null;

    // reject pending RPCs
    for (const [, p] of this.pending) {
      p.reject(new WebSocketError("WebSocket disconnected"));
    }
    this.pending.clear();

    if (
      this.reconnect &&
      this.subs.size > 0 &&
      this.reconnectAttempt < this.reconnectMaxAttempts
    ) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    const delay = this.reconnectBaseDelay * 2 ** this.reconnectAttempt;
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect();
        await this.resubscribeAll();
      } catch {
        if (!this.destroyed && this.subs.size > 0) {
          this.handleDisconnect();
        }
      }
    }, delay);
  }

  private async resubscribeAll() {
    for (const [, entry] of this.subs) {
      await this.sendRpc("subscribe", entry.params);
    }
  }

  private sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new WebSocketError("WebSocket not connected"));
      }

      const id = this.nextId++;
      const msg: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async subscribe(
    params: WsSubscribeParams,
    callback: (data: any) => void
  ): Promise<Subscription> {
    if (this.destroyed) {
      throw new WebSocketError("WebSocket channel has been destroyed");
    }

    await this.connect();

    const key = subKey(params);
    let entry = this.subs.get(key);

    if (entry) {
      // Dedup: reuse existing WS subscription
      entry.callbacks.add(callback);
    } else {
      // New WS subscription
      entry = { params, callbacks: new Set([callback]) };
      this.subs.set(key, entry);
      await this.sendRpc("subscribe", params);
    }

    return {
      unsubscribe: () => {
        const e = this.subs.get(key);
        if (!e) return;
        e.callbacks.delete(callback);
        if (e.callbacks.size === 0) {
          this.subs.delete(key);
          // Best-effort unsubscribe RPC
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.sendRpc("unsubscribe", params).catch(() => {});
          }
          // Auto-close when no subscribers remain
          if (this.subs.size === 0) this.closeQuietly();
        }
      },
    };
  }

  private closeQuietly() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    for (const [, p] of this.pending) {
      p.reject(new WebSocketError("WebSocket channel destroyed"));
    }
    this.pending.clear();
    this.subs.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/extended/v1/ws";
}

export function webSocket(
  url?: string,
  config?: WebSocketTransportConfig
): TransportFactory {
  return (params) => {
    const httpUrl =
      config?.url ??
      params?.chain?.rpcUrls.default.http[0] ??
      "http://localhost:3999";

    const wsUrl =
      url ??
      params?.chain?.rpcUrls.default.ws?.[0] ??
      deriveWsUrl(httpUrl);

    const resolvedHttpConfig: TransportConfig = {
      ...config,
      url: httpUrl,
    };

    const channel = new WebSocketChannel(wsUrl, config);

    const transport: WebSocketTransport = {
      type: "webSocket",
      request: buildRequestFn(httpUrl, resolvedHttpConfig),
      config: resolvedHttpConfig,
      subscribe: (subParams, callback) =>
        channel.subscribe(subParams, callback),
      destroy: () => channel.destroy(),
    };

    return transport;
  };
}
