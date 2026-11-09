const BTC_TXID = /^(?:0x)?[0-9a-f]{64}$/;

/**
 * Normalize a Bitcoin txid to the stored form: `0x` + 64 lowercase hex.
 * Explorers show bare hex; the Index stores (and matches) the prefixed form,
 * so every input boundary (trigger schema, API filters) runs through here.
 * Returns null when the value isn't a 32-byte hex txid.
 */
export function normalizeBtcTxid(value: string): string | null {
	const v = value.trim().toLowerCase();
	if (!BTC_TXID.test(v)) return null;
	return v.startsWith("0x") ? v : `0x${v}`;
}
