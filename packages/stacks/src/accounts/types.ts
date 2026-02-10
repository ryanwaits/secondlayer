/** Account derived from a local private key (mnemonic or raw key). */
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

/** Account with a user-provided signing function (sync or async). */
export type CustomAccount = {
  type: "custom";
  address: string;
  publicKey: string;
  sign(hash: Uint8Array): Promise<Uint8Array> | Uint8Array;
};

/** Browser wallet provider interface (e.g. Leather, Xverse). */
export type StacksProvider = {
  request(method: string, params?: any): Promise<any>;
};

/** Account backed by a browser wallet {@link StacksProvider}. */
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
