export const BNS_CONTRACTS = {
  mainnet: {
    address: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
    name: "BNS-V2",
  },
  testnet: {
    address: "ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D9SZJQ0M",
    name: "BNS-V2",
  },
} as const;

export const ZONEFILE_RESOLVER_CONTRACTS = {
  mainnet: {
    address: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
    name: "zonefile-resolver",
  },
  testnet: {
    address: "ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D9SZJQ0M",
    name: "zonefile-resolver",
  },
} as const;

// BNS v2 uses .btc namespace primarily
export const DEFAULT_NAMESPACE = "btc";
