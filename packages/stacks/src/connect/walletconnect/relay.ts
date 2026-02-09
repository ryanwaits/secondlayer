/** WalletConnect v2 relay client (wss://relay.walletconnect.com) */

import type { WcRelayMessage } from "./types.ts";
import {
  encryptType0,
  decryptType0,
  encodeBase64,
  decodeBase64,
  createRelayAuthJwt,
} from "./crypto.ts";

const DEFAULT_RELAY = "wss://relay.walletconnect.com";
const DEFAULT_TTL = 300; // 5 minutes

type PendingRpc = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

type SubscriptionHandler = (message: WcRelayMessage) => void;

export class WcRelay {
  private ws: WebSocket | null = null;
  private url: string;
  private projectId: string;
  private nextId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  private pending = new Map<number, PendingRpc>();
  private subscriptions = new Map<string, SubscriptionHandler>();
  /** Map subscription ID (from server) → topic */
  private subIdToTopic = new Map<string, string>();
  private destroyed = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectReject: ((e: Error) => void) | null = null;

  constructor(projectId: string, relayUrl?: string) {
    this.projectId = projectId;
    this.url = relayUrl ?? DEFAULT_RELAY;
  }

  // -- Connection --

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectReject = reject;
      const { jwt } = createRelayAuthJwt(this.url);
      const wsUrl = `${this.url}/?auth=${jwt}&projectId=${this.projectId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener(
        "open",
        () => {
          this.reconnectAttempt = 0;
          this.reconnecting = false;
          this.connectPromise = null;
          this.connectReject = null;
          resolve();
        },
        { once: true },
      );

      this.ws.addEventListener(
        "error",
        (e) => {
          this.connectPromise = null;
          this.connectReject = null;
          reject(new Error(`WC relay connection failed: ${e}`));
        },
        { once: true },
      );

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer),
        );
      });

      this.ws.addEventListener("close", () => {
        this.connectPromise = null;
        if (!this.destroyed) this.handleDisconnect();
      });
    });

    return this.connectPromise;
  }

  // -- Publish/Subscribe --

  async subscribe(
    topic: string,
    handler: SubscriptionHandler,
  ): Promise<string> {
    await this.connect();
    this.subscriptions.set(topic, handler);
    const subId = (await this.rpc("irn_subscribe", { topic })) as string;
    this.subIdToTopic.set(subId, topic);
    return subId;
  }

  async publish(
    topic: string,
    message: string,
    tag: number,
    ttl = DEFAULT_TTL,
  ): Promise<void> {
    await this.connect();
    await this.rpc("irn_publish", {
      topic,
      message,
      ttl,
      tag,
      prompt: false,
    });
  }

  /** Encrypt + publish a type-0 envelope */
  async publishEncrypted(
    topic: string,
    symKey: Uint8Array,
    payload: unknown,
    tag: number,
    ttl = DEFAULT_TTL,
  ): Promise<void> {
    const plaintext = JSON.stringify(payload);
    const envelope = encryptType0(symKey, plaintext);
    await this.publish(topic, encodeBase64(envelope), tag, ttl);
  }

  // -- Internal --

  private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WC relay not connected"));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, jsonrpc: "2.0", method, params }));
    });
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // RPC response
    if ("id" in msg && msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(`WC relay error: ${msg.error.message}`));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Server push (irn_subscription)
    if (msg.method === "irn_subscription" && msg.params) {
      const { id: subId, data } = msg.params;
      const topic = data?.topic ?? this.subIdToTopic.get(subId);
      const handler = topic ? this.subscriptions.get(topic) : undefined;
      if (handler && data) {
        handler({
          topic: data.topic,
          message: data.message,
          publishedAt: data.publishedAt ?? Date.now(),
          tag: data.tag ?? 0,
        });
      }
      // Acknowledge
      if (msg.id != null) {
        this.ws?.send(
          JSON.stringify({ id: msg.id, jsonrpc: "2.0", result: true }),
        );
      }
    }
  }

  private handleDisconnect() {
    this.ws = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("WC relay disconnected"));
    }
    this.pending.clear();

    if (this.subscriptions.size > 0 && this.reconnectAttempt < 5) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    const delay = 1000 * 2 ** this.reconnectAttempt;
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect();
        // Re-subscribe all topics
        for (const [topic] of this.subscriptions) {
          const subId = (await this.rpc("irn_subscribe", { topic })) as string;
          this.subIdToTopic.set(subId, topic);
        }
      } catch {
        if (!this.destroyed && this.subscriptions.size > 0) {
          this.handleDisconnect();
        }
      }
    }, delay);
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectReject) {
      this.connectReject(new Error("WC relay destroyed"));
      this.connectReject = null;
      this.connectPromise = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("WC relay destroyed"));
    }
    this.pending.clear();
    this.subscriptions.clear();
    this.subIdToTopic.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
