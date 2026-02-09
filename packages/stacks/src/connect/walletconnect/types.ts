/** WalletConnect v2 protocol types */

export interface WcMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface WcNamespace {
  chains: string[];
  methods: string[];
  events: string[];
}

export interface WcProposal {
  id: number;
  proposer: {
    publicKey: string;
    metadata: WcMetadata;
  };
  requiredNamespaces: Record<string, WcNamespace>;
}

export interface WcSessionSettled {
  relay: { protocol: string };
  namespaces: Record<string, WcNamespace & { accounts: string[] }>;
  controller: { publicKey: string; metadata: WcMetadata };
  expiry: number;
}

export interface WcJsonRpc<T = unknown> {
  id: number;
  jsonrpc: "2.0";
  method: string;
  params: T;
}

export interface WcJsonRpcResult<T = unknown> {
  id: number;
  jsonrpc: "2.0";
  result: T;
}

export interface WcJsonRpcError {
  id: number;
  jsonrpc: "2.0";
  error: { code: number; message: string; data?: unknown };
}

/** Type 0 = symmetric key (pairing), Type 1 = asymmetric (session proposal) */
export type WcEnvelopeType = 0 | 1;

export interface WcRelayMessage {
  topic: string;
  message: string;
  publishedAt: number;
  tag: number;
}

export interface WcPairResult {
  uri: string;
  approval: Promise<WcSessionSettled>;
}

export interface WcProviderConfig {
  projectId: string;
  metadata: WcMetadata;
  relayUrl?: string;
  /** CAIP-2 chain IDs. Default: ["stacks:1"] */
  chains?: string[];
}

/** Persisted session data */
export interface WcSessionData {
  topic: string;
  symKey: string;
  peerMeta: WcMetadata;
  expiry: number;
  accounts: string[];
  controllerPublicKey: string;
}
