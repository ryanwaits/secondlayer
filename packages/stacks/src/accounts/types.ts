export type LocalAccount = {
  type: "local";
  address: string;
  /** Compressed public key (hex) */
  publicKey: string;
  /** Raw ECDSA sign over a hash */
  sign(hash: Uint8Array): Uint8Array;
  /** Sign a structured message (SIP-018) */
  signMessage(message: string | Uint8Array): string;
};

export type CustomAccount = {
  type: "custom";
  address: string;
  publicKey: string;
  sign(hash: Uint8Array): Promise<Uint8Array> | Uint8Array;
};

export type StacksProvider = {
  request(method: string, params?: any): Promise<any>;
};

export type ProviderAccount = {
  type: "provider";
  address: string;
  publicKey: string;
  provider: StacksProvider;
};

export type AccountSource = {
  address: string;
  publicKey: string;
  sign(hash: Uint8Array): Promise<Uint8Array> | Uint8Array;
};
