import { describe, expect, test } from "bun:test";
import { normalizeStreamsEventPayload } from "./streams-events.ts";

// Real mainnet `events.data` rows, one per ingestion era. Era A: hex at
// `value`, memos `0x…` or absent, locks without their contract (to ~7.46M).
// Era B: `value` as a typed object plus `raw_value`, bare-hex memos (to
// 8,124,446). Era C: `raw_value` only, locks name their contract.

const at = (burnBlockHeight: number) => ({ burnBlockHeight });

describe("normalizeStreamsEventPayload: print", () => {
	test("raw_value is the 0x hex in every era", () => {
		const eraA = normalizeStreamsEventPayload(
			"print",
			{
				topic: "print",
				value: "0x09",
				contract_identifier:
					"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-token-v-i28",
			},
			at(942_851),
		);
		const eraB = normalizeStreamsEventPayload(
			"print",
			{
				topic: "print",
				value: { Optional: { data: null } },
				raw_value: "0x09",
				contract_identifier:
					"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-token-v-i28",
			},
			at(950_000),
		);
		const eraC = normalizeStreamsEventPayload(
			"print",
			{
				topic: "print",
				raw_value: "0x09",
				contract_identifier:
					"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-token-v-i28",
			},
			at(955_000),
		);
		for (const { payload, contract_id } of [eraA, eraB, eraC]) {
			expect(payload.raw_value).toBe("0x09");
			expect(payload.topic).toBe("print");
			expect(contract_id).toBe(
				"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-token-v-i28",
			);
		}
	});

	test("legacy value is kept untouched where the row has it", () => {
		const { payload } = normalizeStreamsEventPayload(
			"print",
			{
				topic: "print",
				value: { UInt: 1 },
				raw_value: "0x0100000000000000000000000000000001",
				contract_identifier: "SP1.contract",
			},
			at(950_000),
		);
		expect(payload.value).toEqual({ UInt: 1 });
	});
});

describe("normalizeStreamsEventPayload: nft events", () => {
	test("raw_value is the token id hex in every era", () => {
		const eraA = normalizeStreamsEventPayload(
			"nft_transfer",
			{
				value: "0x010000000000000000000000000000099c",
				sender: "SP277HZA8AGXV42MZKDW5B2NNN61RHQ42MTAHVNB1",
				recipient: "SPV48Q8E5WP4TCQ63E9TV6KF9R4HP01Z8WS3FBTG",
				asset_identifier:
					"SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bitcoin-monkeys::bitcoin-monkeys",
			},
			at(670_000),
		);
		expect(eraA.payload.raw_value).toBe("0x010000000000000000000000000000099c");
		expect(eraA.contract_id).toBe(
			"SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bitcoin-monkeys",
		);

		const eraB = normalizeStreamsEventPayload(
			"nft_mint",
			{
				value: { UInt: 6537 },
				raw_value: "0x0100000000000000000000000000001989",
				recipient: "SP2TKV4VPWB39W8WESHJYBWZP268VND7Z2DZDAH5K",
				asset_identifier:
					"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-core-v-i28::minimint",
			},
			at(950_000),
		);
		expect(eraB.payload.raw_value).toBe("0x0100000000000000000000000000001989");

		const eraC = normalizeStreamsEventPayload(
			"nft_burn",
			{
				raw_value: "0x0100000000000000000000000000001989",
				sender: "SP2TKV4VPWB39W8WESHJYBWZP268VND7Z2DZDAH5K",
				asset_identifier:
					"SP5K2RHMSBH4PAP4PGX77MCVNK1ZEED07CWX9TJT.minimint-core-v-i28::minimint",
			},
			at(955_000),
		);
		expect(eraC.payload.raw_value).toBe("0x0100000000000000000000000000001989");
	});
});

describe("normalizeStreamsEventPayload: stx_transfer memo", () => {
	const transfer = {
		amount: "5000",
		sender: "SP2GM6VJC349T9TQ9X7QCP0DNGKSTA9AQ1W243241",
		recipient: "SP1DV3T4ST2A89ZZ07M73B2N4AR5XFMDCNPGKK6CS",
	};
	const memoOf = (data: Record<string, unknown>) =>
		normalizeStreamsEventPayload("stx_transfer", data, at(950_000)).payload
			.memo;

	test("a 0x-prefixed memo (era A) and the same bare memo (era B) serve identically", () => {
		expect(memoOf({ ...transfer, memo: "0x783430323a6d706265616f6e38" })).toBe(
			"0x783430323a6d706265616f6e38",
		);
		expect(memoOf({ ...transfer, memo: "783430323a6d706265616f6e38" })).toBe(
			"0x783430323a6d706265616f6e38",
		);
	});

	test("a zero-filled token-transfer memo keeps its bytes", () => {
		const zeros = "00".repeat(34);
		expect(memoOf({ ...transfer, memo: zeros })).toBe(`0x${zeros}`);
		expect(memoOf({ ...transfer, memo: `0x${zeros}` })).toBe(`0x${zeros}`);
	});

	test("a transfer without a memo is null, whether the key is missing or empty", () => {
		const missing = normalizeStreamsEventPayload(
			"stx_transfer",
			transfer,
			at(942_851),
		).payload;
		expect("memo" in missing).toBe(true);
		expect(missing.memo).toBeNull();
		expect(memoOf({ ...transfer, memo: "" })).toBeNull();
		expect(memoOf({ ...transfer, memo: "0x" })).toBeNull();
	});
});

describe("normalizeStreamsEventPayload: stx_lock", () => {
	test("an era-A lock gets the PoX contract of its burn height", () => {
		const pox4 = normalizeStreamsEventPayload(
			"stx_lock",
			{
				locked_amount: "1397097537707",
				unlock_height: "945350",
				locked_address:
					"SP8A9HZ3PKST0S42VM9523Z9NV42SZ026V4K39WH.ccd002-treasury-mia-rewards-v3",
			},
			at(942_851),
		);
		expect(pox4.contract_id).toBe("SP000000000000000000002Q6VF78.pox-4");
		expect(pox4.payload.contract_identifier).toBe(
			"SP000000000000000000002Q6VF78.pox-4",
		);

		const pox1 = normalizeStreamsEventPayload(
			"stx_lock",
			{
				locked_amount: "126665999740",
				unlock_height: "670250",
				locked_address: "SP2SCMDC235BXA63P6X00803TSDFJ0J6P236K537W",
			},
			at(667_417),
		);
		expect(pox1.contract_id).toBe("SP000000000000000000002Q6VF78.pox");
	});

	test("an era-C lock keeps the contract it was stored with", () => {
		const { payload, contract_id } = normalizeStreamsEventPayload(
			"stx_lock",
			{
				locked_amount: "900000000",
				unlock_height: "1163750",
				locked_address: "SP1EPHAVJAEC6V13B9ZT65PXJPQDMN3B1Z1CMMQ0E",
				contract_identifier: "SP000000000000000000002Q6VF78.pox-5",
			},
			at(960_974),
		);
		expect(contract_id).toBe("SP000000000000000000002Q6VF78.pox-5");
		expect(payload.contract_identifier).toBe(
			"SP000000000000000000002Q6VF78.pox-5",
		);
	});
});
