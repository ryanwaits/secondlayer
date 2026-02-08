export type StacksChain = {
  /** Chain ID (e.g. 0x00000001 for mainnet) */
  id: number;
  /** Human-readable name */
  name: string;
  /** Network type */
  network: "mainnet" | "testnet";
  /** Transaction version byte for serialization */
  transactionVersion: number;
  /** Peer network ID for P2P broadcasting */
  peerNetworkId: number;
  /** Address version bytes */
  addressVersion: {
    singleSig: number;
    multiSig: number;
  };
  /** Magic bytes for network identification */
  magicBytes: string;
  /** Boot address (system contracts deployer) */
  bootAddress: string;
  /** Native currency info */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Default RPC URLs */
  rpcUrls: {
    default: { http: string[]; ws?: string[] };
  };
  /** Block explorer URLs */
  blockExplorers?: {
    default: { name: string; url: string };
  };
};
