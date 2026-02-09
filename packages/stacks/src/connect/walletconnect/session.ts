/** WalletConnect v2 session state machine (pairing → proposal → settlement) */

import type {
  WcProviderConfig,
  WcPairResult,
  WcSessionSettled,
  WcSessionData,
  WcJsonRpc,
  WcProposal,
} from "./types.ts";
import {
  generateKeyPair,
  generateSymKey,
  deriveSymKey,
  symKeyToTopic,
  decryptType0,
  decryptType1,
  decodeBase64,
  bytesToHex,
  hexToBytes,
} from "./crypto.ts";
import { WcRelay } from "./relay.ts";

const STORAGE_KEY = "@secondlayer/wc:session";
const SESSION_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

const STACKS_METHODS = [
  "stx_getAddresses",
  "stx_transferStx",
  "stx_callContract",
  "stx_deployContract",
  "stx_signMessage",
  "stx_signTransaction",
];

const STACKS_EVENTS = ["chainChanged", "accountsChanged"];

declare const localStorage:
  | {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    }
  | undefined;

function getStorage() {
  return typeof localStorage !== "undefined" ? localStorage : undefined;
}

export class WcSession {
  private relay: WcRelay;
  private config: WcProviderConfig;
  private chains: string[];

  // Pairing state
  private pairingSymKey: Uint8Array | null = null;
  private pairingTopic: string | null = null;
  private selfKeyPair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;

  // Session state
  private sessionData: WcSessionData | null = null;
  private sessionSymKey: Uint8Array | null = null;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = Date.now();

  constructor(config: WcProviderConfig) {
    this.config = config;
    this.chains = config.chains ?? ["stacks:1"];
    this.relay = new WcRelay(config.projectId, config.relayUrl);
  }

  /** Try restoring a persisted session. Returns true if valid session found. */
  restore(): boolean {
    try {
      const raw = getStorage()?.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as WcSessionData;
      if (data.expiry < Date.now() / 1000) {
        getStorage()?.removeItem(STORAGE_KEY);
        return false;
      }
      this.sessionData = data;
      this.sessionSymKey = hexToBytes(data.symKey);
      // Subscribe to session topic for incoming requests (fire-and-forget)
      this.subscribeSession().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /** Initiate pairing. Returns URI for QR code + approval promise. */
  async pair(): Promise<WcPairResult> {
    this.pairingSymKey = generateSymKey();
    this.pairingTopic = symKeyToTopic(this.pairingSymKey);
    this.selfKeyPair = generateKeyPair();

    const symKeyHex = bytesToHex(this.pairingSymKey);
    const uri = `wc:${this.pairingTopic}@2?relay-protocol=irn&symKey=${symKeyHex}`;

    const approval = new Promise<WcSessionSettled>((resolve, reject) => {
      this.relay
        .subscribe(this.pairingTopic!, (msg) => {
          try {
            this.handlePairingMessage(msg.message, resolve, reject);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })
        .catch(reject);
    });

    return { uri, approval };
  }

  /** Send a JSON-RPC request over the session. */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.sessionData || !this.sessionSymKey) {
      throw new Error("No active WC session");
    }

    const id = this.nextId++;
    const payload = {
      id,
      jsonrpc: "2.0" as const,
      method: "wc_sessionRequest",
      params: {
        request: { method, params },
        chainId: this.chains[0],
      },
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.relay
        .publishEncrypted(
          this.sessionData!.topic,
          this.sessionSymKey!,
          payload,
          1108, // tag for session request
          SESSION_EXPIRY,
        )
        .catch((err) => {
          this.pending.delete(id);
          reject(err);
        });
    });
  }

  disconnect() {
    if (this.sessionData && this.sessionSymKey) {
      const id = this.nextId++;
      const payload = {
        id,
        jsonrpc: "2.0",
        method: "wc_sessionDelete",
        params: { code: 6000, message: "User disconnected" },
      };
      // Best-effort notify peer
      this.relay
        .publishEncrypted(
          this.sessionData.topic,
          this.sessionSymKey,
          payload,
          1112,
        )
        .catch(() => {});
    }
    this.sessionData = null;
    this.sessionSymKey = null;
    this.pending.clear();
    getStorage()?.removeItem(STORAGE_KEY);
    this.relay.destroy();
  }

  get session(): WcSessionData | null {
    return this.sessionData;
  }

  // -- Internal --

  private handlePairingMessage(
    message: string,
    resolve: (v: WcSessionSettled) => void,
    reject: (e: Error) => void,
  ) {
    const envelope = decodeBase64(message);
    let plaintext: string;

    // Could be type 0 (symmetric) or type 1 (asymmetric)
    if (envelope[0] === 0x01 && this.selfKeyPair) {
      plaintext = decryptType1(this.selfKeyPair.privateKey, envelope);
    } else if (this.pairingSymKey) {
      plaintext = decryptType0(this.pairingSymKey, envelope);
    } else {
      return;
    }

    let rpc: WcJsonRpc;
    try {
      rpc = JSON.parse(plaintext) as WcJsonRpc;
    } catch {
      return;
    }

    if (rpc.method === "wc_sessionPropose") {
      this.handleProposal(rpc as WcJsonRpc<WcProposal>, resolve, reject).catch(reject);
    }
  }

  private async handleProposal(
    rpc: WcJsonRpc<WcProposal>,
    resolve: (v: WcSessionSettled) => void,
    reject: (e: Error) => void,
  ) {
    try {
      const proposal = rpc.params;
      const peerPublicKey = hexToBytes(proposal.proposer.publicKey);

      // Generate session key pair + derive session symmetric key
      const sessionKp = generateKeyPair();
      const sessionSymKey = deriveSymKey(sessionKp.privateKey, peerPublicKey);
      const sessionTopic = symKeyToTopic(sessionSymKey);

      const expiry = Math.floor(Date.now() / 1000) + SESSION_EXPIRY;

      const settled: WcSessionSettled = {
        relay: { protocol: "irn" },
        namespaces: {
          stacks: {
            chains: this.chains,
            methods: STACKS_METHODS,
            events: STACKS_EVENTS,
            accounts: this.chains.map((c) => `${c}:placeholder`),
          },
        },
        controller: {
          publicKey: bytesToHex(sessionKp.publicKey),
          metadata: this.config.metadata,
        },
        expiry,
      };

      // Approve the proposal on the pairing topic
      const approvePayload = {
        id: rpc.id,
        jsonrpc: "2.0",
        result: {
          relay: { protocol: "irn" },
          responderPublicKey: bytesToHex(sessionKp.publicKey),
        },
      };

      await this.relay.publishEncrypted(
        this.pairingTopic!,
        this.pairingSymKey!,
        approvePayload,
        1101, // tag for session propose response
      );

      // Subscribe to session topic
      this.sessionSymKey = sessionSymKey;
      this.sessionData = {
        topic: sessionTopic,
        symKey: bytesToHex(sessionSymKey),
        peerMeta: proposal.proposer.metadata,
        expiry,
        accounts: [],
        controllerPublicKey: proposal.proposer.publicKey,
      };

      await this.subscribeSession();

      // Send session settle on the new session topic
      const settlePayload = {
        id: this.nextId++,
        jsonrpc: "2.0",
        method: "wc_sessionSettle",
        params: settled,
      };

      await this.relay.publishEncrypted(
        sessionTopic,
        sessionSymKey,
        settlePayload,
        1104, // tag for session settle
      );

      // Persist
      getStorage()?.setItem(STORAGE_KEY, JSON.stringify(this.sessionData));

      resolve(settled);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async subscribeSession() {
    if (!this.sessionData || !this.sessionSymKey) return;

    const symKey = this.sessionSymKey;
    await this.relay.subscribe(this.sessionData.topic, (msg) => {
      try {
        const envelope = decodeBase64(msg.message);
        const plaintext = decryptType0(symKey, envelope);
        const rpc = JSON.parse(plaintext);

        // Response to our request
        if ("id" in rpc && this.pending.has(rpc.id)) {
          const p = this.pending.get(rpc.id)!;
          this.pending.delete(rpc.id);
          if (rpc.error) {
            p.reject(new Error(rpc.error.message ?? "WC request failed"));
          } else {
            p.resolve(rpc.result);
          }
        }

        // Session delete from peer
        if (rpc.method === "wc_sessionDelete") {
          this.sessionData = null;
          this.sessionSymKey = null;
          this.pending.clear();
          getStorage()?.removeItem(STORAGE_KEY);
        }
      } catch {
        // ignore malformed messages
      }
    });
  }
}
