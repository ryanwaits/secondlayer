export const POX_CONTRACTS = {
  mainnet: {
    address: "SP000000000000000000002Q6VF78",
    name: "pox-4",
  },
  testnet: {
    address: "ST000000000000000000002AMW42H",
    name: "pox-4",
  },
} as const;

export const MIN_LOCK_PERIOD = 1;
export const MAX_LOCK_PERIOD = 12;

/** PoX address version bytes (maps to Bitcoin address types) */
export const POX_ADDRESS_VERSION = {
  /** P2PKH - legacy addresses starting with "1" */
  p2pkh: 0x00,
  /** P2SH - script hash addresses starting with "3" */
  p2sh: 0x01,
  /** P2SH-P2WPKH - nested segwit */
  p2sh_p2wpkh: 0x02,
  /** P2SH-P2WSH - nested segwit script */
  p2sh_p2wsh: 0x03,
  /** P2WPKH - native segwit "bc1q" (20-byte hash) */
  p2wpkh: 0x04,
  /** P2WSH - native segwit "bc1q" (32-byte hash) */
  p2wsh: 0x05,
  /** P2TR - taproot "bc1p" (32-byte key) */
  p2tr: 0x06,
} as const;
