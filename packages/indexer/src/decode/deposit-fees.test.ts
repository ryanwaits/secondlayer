import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { RawTransaction } from "./bitcoin-rpc.ts";
import { depositFee, depositMaxFee, fillDepositFees } from "./deposit-fees.ts";

const HAS_DB = !!process.env.DATABASE_URL;

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

// First mainnet v2 deposit, 1ad0b6c8…3d68:0, swept by fc257580…42b7 input 4.
// 10,000 sats in, 9,147 minted, the signers took 853, max fee 4,000.
const V2_DEPOSIT_TXID =
	"1ad0b6c81d625381c05c4d4fc1d5b9ae89f92cf8b84f440d47d9c00b55543d68";
const V2_RECIPIENT = "SP2T1Y6XZYJFMRXCZ3DBE6SD5YBJP8WK2PXG96ZG";
const V2_PREIMAGE =
	"c439059d092649d272edf94f512ba26f135b17a6795dbf9cb52130b26574ce22";
const V2_DEPOSIT_SCRIPT =
	"82012088a820f3badb2c39cf3709b293d781a1d0ff57529ee0ccf70762b89f2b8f480ef123e98820045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c";
// Synthetic v2 deposit to the pox-5 contract at the miners' 80,000.
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const POX5_PREIMAGE =
	"0fa50bdfd060415fdd75c56d698c07b28648f3a6ad4f7bcf353a4081b98b7ade";

const v2Script = (preimageHex: string) =>
	`82012088a820${createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex")}8820${"11".repeat(32)}ac`;

function sweepWith(
	witness: string[],
	depositTxid = DEPOSIT_TXID,
): RawTransaction {
	return {
		txid: "98392a65",
		vin: [
			{ txid: "aa".repeat(32), vout: 0, txinwitness: ["00", "00", "00"] },
			{ txid: depositTxid, vout: 0, txinwitness: witness },
		],
		vout: [],
	};
}

const v2Witness = (preimage = V2_PREIMAGE) => [
	"",
	"sig",
	preimage,
	V2_DEPOSIT_SCRIPT,
	"control",
];
const v2Sweep = (witness = v2Witness()) => sweepWith(witness, V2_DEPOSIT_TXID);

const V1_KNOWN = { recipient: null, fee: "129" };

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
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 0, V1_KNOWN)).toBe(
			"80000",
		);
	});

	test("is null when the sweep does not spend that output", () => {
		const sweep = sweepWith(["sig", DEPOSIT_SCRIPT, "control"]);
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 1, V1_KNOWN)).toBeNull();
	});

	test("is null for a script that is not a deposit script", () => {
		const sweep = sweepWith(["sig", "20aabbccddeeff00112233ac", "control"]);
		expect(depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 0, V1_KNOWN)).toBeNull();
	});

	test("finds a v2 deposit's max fee by matching the revealed hash against the recipient", () => {
		expect(
			depositMaxFee(v2Sweep(), `0x${V2_DEPOSIT_TXID}`, 0, {
				recipient: V2_RECIPIENT,
				fee: "853",
			}),
		).toBe("4000");
	});

	test("finds the miners' 80,000 for a v2 deposit to a contract", () => {
		const sweep = sweepWith(
			["sig", POX5_PREIMAGE, v2Script(POX5_PREIMAGE), "control"],
			V2_DEPOSIT_TXID,
		);
		expect(
			depositMaxFee(sweep, `0x${V2_DEPOSIT_TXID}`, 0, {
				recipient: POX5,
				fee: "300",
			}),
		).toBe("80000");
	});

	test("is null for a v2 deposit when the recipient is unknown or does not match", () => {
		expect(
			depositMaxFee(v2Sweep(), `0x${V2_DEPOSIT_TXID}`, 0, {
				recipient: null,
				fee: "853",
			}),
		).toBeNull();
		expect(
			depositMaxFee(v2Sweep(), `0x${V2_DEPOSIT_TXID}`, 0, {
				recipient: POX5,
				fee: "853",
			}),
		).toBeNull();
	});

	test("is null for a v2 script whose revealed value does not hash to its commitment", () => {
		expect(
			depositMaxFee(
				v2Sweep(v2Witness("00".repeat(32))),
				`0x${V2_DEPOSIT_TXID}`,
				0,
				{ recipient: V2_RECIPIENT, fee: "853" },
			),
		).toBeNull();
	});

	test("still reads a v1 script whatever recipient and fee are passed", () => {
		const sweep = sweepWith(["sig", DEPOSIT_SCRIPT, "control"]);
		expect(
			depositMaxFee(sweep, `0x${DEPOSIT_TXID}`, 0, {
				recipient: V2_RECIPIENT,
				fee: "853",
			}),
		).toBe("80000");
	});
});

function fakeReader(txs: Record<string, RawTransaction>) {
	const calls: string[] = [];
	return {
		calls,
		async getRawTransaction(txid: string) {
			calls.push(txid);
			return txs[txid.startsWith("0x") ? txid.slice(2) : txid] ?? null;
		},
	};
}

const v2DepositTx: RawTransaction = {
	txid: V2_DEPOSIT_TXID,
	vin: [],
	vout: [{ n: 0, value: 0.0001 }],
};

function depositRow(overrides: {
	fee: string | null;
	recipient: string;
	max_fee?: string | null;
}) {
	return {
		cursor: "200:0",
		block_height: 200,
		block_time: new Date("2026-11-10T00:00:00.000Z"),
		tx_id: "d1",
		tx_index: 0,
		event_index: 0,
		topic: "completed-deposit" as const,
		request_id: null,
		amount: "9147",
		sender: null,
		recipient: overrides.recipient,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: `0x${V2_DEPOSIT_TXID}`,
		output_index: 0,
		sweep_txid: "0xsweepv2",
		burn_hash: null,
		burn_height: null,
		signer_bitmap: null,
		max_fee: overrides.max_fee ?? null,
		fee: overrides.fee,
		block_height_at_request: null,
		governance_contract_type: null,
		governance_new_contract: null,
		signer_aggregate_pubkey: null,
		signer_threshold: null,
		signer_address: null,
		signer_keys_count: null,
		canonical: true,
		source_cursor: "200:0",
	};
}

describe.skipIf(!HAS_DB)("fillDepositFees (DB)", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM sbtc_events`.execute(db);
	});

	async function readRow() {
		if (!db) throw new Error("missing db");
		return db
			.selectFrom("sbtc_events")
			.select(["fee", "max_fee"])
			.where("cursor", "=", "200:0")
			.executeTakeFirstOrThrow();
	}

	const readerWithV2 = () =>
		fakeReader({
			[V2_DEPOSIT_TXID]: v2DepositTx,
			sweepv2: v2Sweep(),
		});

	test("fills max_fee on a v2 deposit that already had its fee", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(depositRow({ fee: "853", recipient: V2_RECIPIENT }))
			.execute();
		await fillDepositFees({
			reader: readerWithV2(),
			db,
			unreadable: new Set(),
		});
		expect(await readRow()).toEqual({ fee: "853", max_fee: "4000" });
	});

	test("fills fee and max_fee together on a new v2 deposit", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(depositRow({ fee: null, recipient: V2_RECIPIENT }))
			.execute();
		await fillDepositFees({
			reader: readerWithV2(),
			db,
			unreadable: new Set(),
		});
		expect(await readRow()).toEqual({ fee: "853", max_fee: "4000" });
	});

	test("reads an unreadable sweep once, not on every tick", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(depositRow({ fee: "853", recipient: POX5 }))
			.execute();
		const reader = readerWithV2();
		const unreadable = new Set<string>();
		await fillDepositFees({ reader, db, unreadable });
		expect((await readRow()).max_fee).toBeNull();
		expect([...unreadable]).toEqual(["200:0"]);
		const callsAfterFirst = reader.calls.length;
		expect(await fillDepositFees({ reader, db, unreadable })).toBe(0);
		expect(reader.calls.length).toBe(callsAfterFirst);
	});

	test("retries a deposit whose sweep bitcoind cannot return yet", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(depositRow({ fee: "853", recipient: V2_RECIPIENT }))
			.execute();
		const unreadable = new Set<string>();
		await fillDepositFees({
			reader: fakeReader({ [V2_DEPOSIT_TXID]: v2DepositTx }),
			db,
			unreadable,
		});
		expect(unreadable.size).toBe(0);
		expect((await readRow()).max_fee).toBeNull();
	});
});
