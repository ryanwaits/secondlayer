import { describe, expect, test } from "bun:test";
import { toIndexTxId } from "./x402.ts";

describe("toIndexTxId", () => {
	// decoded_events stores tx_id as lowercase `0x`-prefixed hex; x402 broadcast/
	// ledger txids are bare lowercase hex. Querying the index with the bare form
	// silently never matched → the rail's confirmation layer was wedged (optimistic
	// payments reverted + struck the payer; confirmed-tier never confirmed).
	const indexForm =
		"0x3473dd321da37898cd8bd152673de28fd6f7cfe10fb30bc4072ea783e14c6c8f";
	const bare =
		"3473dd321da37898cd8bd152673de28fd6f7cfe10fb30bc4072ea783e14c6c8f";

	test("bare x402 txid → 0x-prefixed index form", () => {
		expect(toIndexTxId(bare)).toBe(indexForm);
	});

	test("already 0x-prefixed → unchanged (idempotent)", () => {
		expect(toIndexTxId(indexForm)).toBe(indexForm);
	});

	test("uppercase hex → lowercased to match the index", () => {
		expect(toIndexTxId(bare.toUpperCase())).toBe(indexForm);
		expect(toIndexTxId(`0x${bare.toUpperCase()}`)).toBe(indexForm);
	});
});
