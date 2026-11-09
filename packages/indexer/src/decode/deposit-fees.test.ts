import { describe, expect, test } from "bun:test";
import type { RawTransaction } from "./bitcoin-rpc.ts";
import { depositFee, depositMaxFee } from "./deposit-fees.ts";

// Mainnet deposit 5a2510ce…1080:0 — 14,154 sats in, max fee 80,000, 14,025
// minted, so the signers took 129.
const DEPOSIT_TXID =
	"5a2510ced4829cb7e3d11b0fb6b631bd89217c738bca4c3a67f07f4d71de1080";
const DEPOSIT_SCRIPT =
	"1e00000000000138800516c915da24746dbe02b9ead9b2fc477aa1a61858d97520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac";

const depositTx: RawTransaction = {
	txid: DEPOSIT_TXID,
	vin: [],
	vout: [
		{ n: 0, value: 0.00014154 },
		{ n: 1, value: 0.5 },
	],
};

function sweepWith(witness: string[]): RawTransaction {
	return {
		txid: "98392a65",
		vin: [
			{ txid: "aa".repeat(32), vout: 0, txinwitness: ["00", "00", "00"] },
			{ txid: DEPOSIT_TXID, vout: 0, txinwitness: witness },
		],
		vout: [],
	};
}

describe("depositFee", () => {
	test("is the deposit output's value minus the minted amount", () => {
		expect(depositFee(depositTx, 0, "14025")).toBe("129");
	});

	test("is null when the output is missing or minted more than it held", () => {
		expect(depositFee(depositTx, 5, "14025")).toBeNull();
		expect(depositFee(depositTx, 0, "20000")).toBeNull();
	});
});

describe("depositMaxFee", () => {
	test("reads the max fee from the deposit script in the sweep witness", () => {
		const sweep = sweepWith(["sig", DEPOSIT_SCRIPT, "control"]);
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 0)).toBe("80000");
	});

	test("is null when the sweep does not spend that output", () => {
		const sweep = sweepWith(["sig", DEPOSIT_SCRIPT, "control"]);
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 1)).toBeNull();
	});

	test("is null for a script that is not a deposit script", () => {
		const sweep = sweepWith(["sig", "20aabbccddeeff00112233ac", "control"]);
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 0)).toBeNull();
	});
});
