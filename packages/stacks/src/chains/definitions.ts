import type { StacksChain } from "./types.ts";

export const mainnet: StacksChain = {
  id: 0x00000001,
  name: "Stacks Mainnet",
  network: "mainnet",
  transactionVersion: 0x00,
  peerNetworkId: 0x17000000,
  addressVersion: { singleSig: 22, multiSig: 20 },
  magicBytes: "X2",
  bootAddress: "SP000000000000000000002Q6VF78",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: {
      http: ["https://api.mainnet.hiro.so"],
      ws: ["wss://api.mainnet.hiro.so/extended/v1/ws"],
    },
  },
  blockExplorers: {
    default: { name: "Hiro Explorer", url: "https://explorer.hiro.so" },
  },
};

export const testnet: StacksChain = {
  id: 0x80000000,
  name: "Stacks Testnet",
  network: "testnet",
  transactionVersion: 0x80,
  peerNetworkId: 0xff000000,
  addressVersion: { singleSig: 26, multiSig: 21 },
  magicBytes: "T2",
  bootAddress: "ST000000000000000000002AMW42H",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: {
      http: ["https://api.testnet.hiro.so"],
      ws: ["wss://api.testnet.hiro.so/extended/v1/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Hiro Explorer",
      url: "https://explorer.hiro.so/?chain=testnet",
    },
  },
};

export const devnet: StacksChain = {
  id: 0x80000000,
  name: "Stacks Devnet",
  network: "testnet",
  transactionVersion: 0x80,
  peerNetworkId: 0xff000000,
  addressVersion: { singleSig: 26, multiSig: 21 },
  magicBytes: "id",
  bootAddress: "ST000000000000000000002AMW42H",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: {
      http: ["http://localhost:3999"],
      ws: ["ws://localhost:3999/extended/v1/ws"],
    },
  },
};

export const mocknet: StacksChain = {
  ...devnet,
  name: "Stacks Mocknet",
  addressVersion: { ...devnet.addressVersion },
};
