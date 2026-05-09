import { describe, expect, test } from "bun:test";
import {
	boolCV,
	bufferCV,
	falseCV,
	noneCV,
	responseErrorCV,
	responseOkCV,
	serializeCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	trueCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import {
	type Pox4TxRow,
	coerceBlockTime,
	decodePox4Cursor,
	decodePox4Tx,
	encodePox4Cursor,
} from "./pox-4.ts";

const CALLER = "SP1HEZRWXQDS2HCK6MXNZWBHNCXMKKR9TEJTBQHZK";
const STACKER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const DELEGATE_PRINCIPAL = "SP000000000000000000002Q6VF78";
const POX_HASHBYTES_20 = new Uint8Array(20).fill(0x11);
const SIGNER_KEY_33 = new Uint8Array(33).fill(0xab);
const SIGNER_SIG_65 = new Uint8Array(65).fill(0xcd);

function hex(cv: ReturnType<typeof serializeCV>): string {
	return typeof cv === "string" ? cv : `0x${cv}`;
}

function poxAddrCV(versionByte: number, hashbytes: Uint8Array) {
	return tupleCV({
		version: bufferCV(new Uint8Array([versionByte])),
		hashbytes: bufferCV(hashbytes),
	});
}

function makeArgs(...cvs: Parameters<typeof serializeCV>[0][]): string {
	return JSON.stringify(cvs.map((cv) => hex(serializeCV(cv))));
}

function fixtureTx(overrides: Partial<Pox4TxRow> = {}): Pox4TxRow {
	return {
		tx_id: "0xabc",
		block_height: 1_000_000,
		tx_index: 0,
		function_name: "stack-stx",
		function_args: "[]",
		raw_result: hex(serializeCV(responseOkCV(trueCV()))),
		sender: CALLER,
		block_time: new Date("2026-05-07T00:00:00.000Z"),
		burn_block_height: 902_481,
		...overrides,
	};
}

describe("coerceBlockTime", () => {
	test("passes through Date", () => {
		const d = new Date("2026-05-07T00:00:00.000Z");
		expect(coerceBlockTime(d)).toBe(d);
	});

	test("treats bigint-string (pg bigint) as epoch seconds", () => {
		// pg returns blocks.timestamp (bigint epoch-seconds) as a string of digits.
		// new Date("1746813000") would be Invalid Date — must convert via Number()*1000.
		const got = coerceBlockTime("1746813000");
		expect(got.getTime()).toBe(1_746_813_000_000);
		expect(Number.isNaN(got.getTime())).toBe(false);
	});

	test("treats numeric epoch seconds as seconds", () => {
		expect(coerceBlockTime(1_746_813_000).getTime()).toBe(1_746_813_000_000);
	});
});

describe("encode/decodePox4Cursor", () => {
	test("round-trips", () => {
		const c = encodePox4Cursor(7_869_999, 4);
		expect(c).toBe("7869999:4");
		expect(decodePox4Cursor(c)).toEqual({ blockHeight: 7_869_999, txIndex: 4 });
	});
});

describe("decodePox4Tx — solo + delegate", () => {
	test("returns null for unsupported function", () => {
		const row = fixtureTx({ function_name: "nope" });
		expect(decodePox4Tx(row)).toBeNull();
	});

	test("stack-stx populates lock period, cycles, signer key, pox addr btc", () => {
		const startBurn = 902_481n;
		// burnHeight - 666050 / 2100 = (902481 - 666050) / 2100 = 112
		const expectedStartCycle = Number((startBurn - 666_050n) / 2_100n);
		const args = makeArgs(
			uintCV(100_000_000_000n),
			poxAddrCV(0x04, POX_HASHBYTES_20), // p2wpkh
			uintCV(startBurn),
			uintCV(6n),
			noneCV(), // signer-sig
			bufferCV(SIGNER_KEY_33),
			uintCV(200_000_000_000n),
			uintCV(1n),
		);
		const row = fixtureTx({ function_name: "stack-stx", function_args: args });
		const decoded = decodePox4Tx(row);
		expect(decoded).not.toBeNull();
		expect(decoded?.function_name).toBe("stack-stx");
		expect(decoded?.caller).toBe(CALLER);
		expect(decoded?.amount_ustx).toBe("100000000000");
		expect(decoded?.lock_period).toBe(6);
		expect(decoded?.start_cycle).toBe(expectedStartCycle);
		expect(decoded?.end_cycle).toBe(expectedStartCycle + 5);
		expect(decoded?.pox_addr_version).toBe(0x04);
		expect(decoded?.pox_addr_btc?.startsWith("bc1q")).toBe(true);
		expect(decoded?.signer_key).toBe(`0x${"ab".repeat(33)}`);
		expect(decoded?.signer_signature).toBeNull();
		expect(decoded?.max_amount).toBe("200000000000");
		expect(decoded?.auth_id).toBe("1");
		expect(decoded?.result_ok).toBe(true);
	});

	test("stack-extend populates lock_period without amount_ustx", () => {
		const args = makeArgs(
			uintCV(3n),
			poxAddrCV(0x04, POX_HASHBYTES_20),
			someCV(bufferCV(SIGNER_SIG_65)),
			bufferCV(SIGNER_KEY_33),
			uintCV(500_000_000_000n),
			uintCV(2n),
		);
		const row = fixtureTx({
			function_name: "stack-extend",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.lock_period).toBe(3);
		expect(decoded?.amount_ustx).toBeNull();
		expect(decoded?.signer_signature).toBe(`0x${"cd".repeat(65)}`);
		expect(decoded?.auth_id).toBe("2");
	});

	test("stack-increase populates amount_ustx", () => {
		const args = makeArgs(
			uintCV(50_000_000_000n),
			noneCV(),
			bufferCV(SIGNER_KEY_33),
			uintCV(100_000_000_000n),
			uintCV(7n),
		);
		const row = fixtureTx({
			function_name: "stack-increase",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.amount_ustx).toBe("50000000000");
		expect(decoded?.lock_period).toBeNull();
		expect(decoded?.auth_id).toBe("7");
	});

	test("delegate-stx with optional pox-addr present", () => {
		const args = makeArgs(
			uintCV(1_000_000_000n),
			standardPrincipalCV(DELEGATE_PRINCIPAL),
			noneCV(), // until-burn-ht
			someCV(poxAddrCV(0x04, POX_HASHBYTES_20)),
		);
		const row = fixtureTx({
			function_name: "delegate-stx",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.delegate_to).toBe(DELEGATE_PRINCIPAL);
		expect(decoded?.amount_ustx).toBe("1000000000");
		expect(decoded?.pox_addr_btc?.startsWith("bc1q")).toBe(true);
	});

	test("delegate-stx with `none` pox-addr leaves pox columns null", () => {
		const args = makeArgs(
			uintCV(1_000_000_000n),
			standardPrincipalCV(DELEGATE_PRINCIPAL),
			noneCV(),
			noneCV(),
		);
		const row = fixtureTx({
			function_name: "delegate-stx",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.delegate_to).toBe(DELEGATE_PRINCIPAL);
		expect(decoded?.pox_addr_btc).toBeNull();
		expect(decoded?.pox_addr_version).toBeNull();
	});

	test("revoke-delegate-stx sets stacker = caller, no other fields", () => {
		const row = fixtureTx({
			function_name: "revoke-delegate-stx",
			function_args: "[]",
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.stacker).toBe(CALLER);
		expect(decoded?.delegate_to).toBeNull();
		expect(decoded?.amount_ustx).toBeNull();
	});

	test("delegate-stack-stx: stacker from arg differs from caller", () => {
		const args = makeArgs(
			standardPrincipalCV(STACKER),
			uintCV(50_000_000_000n),
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(902_481n),
			uintCV(6n),
		);
		const row = fixtureTx({
			function_name: "delegate-stack-stx",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.caller).toBe(CALLER);
		expect(decoded?.stacker).toBe(STACKER);
		expect(decoded?.amount_ustx).toBe("50000000000");
		expect(decoded?.lock_period).toBe(6);
		expect(decoded?.start_cycle).not.toBeNull();
	});

	test("delegate-stack-extend", () => {
		const args = makeArgs(
			standardPrincipalCV(STACKER),
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(2n),
		);
		const row = fixtureTx({
			function_name: "delegate-stack-extend",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.stacker).toBe(STACKER);
		expect(decoded?.lock_period).toBe(2);
	});

	test("delegate-stack-increase", () => {
		const args = makeArgs(
			standardPrincipalCV(STACKER),
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(10_000_000n),
		);
		const row = fixtureTx({
			function_name: "delegate-stack-increase",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.stacker).toBe(STACKER);
		expect(decoded?.amount_ustx).toBe("10000000");
	});

	test("stack-aggregation-commit-indexed: signer index parsed from result.ok", () => {
		const args = makeArgs(
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(87n),
			noneCV(),
			bufferCV(SIGNER_KEY_33),
			uintCV(500_000_000_000n),
			uintCV(1n),
		);
		const okIndex = hex(serializeCV(responseOkCV(uintCV(3n))));
		const row = fixtureTx({
			function_name: "stack-aggregation-commit-indexed",
			function_args: args,
			raw_result: okIndex,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.aggregated_signer_index).toBe(3);
		expect(decoded?.reward_cycle).toBe(87);
		expect(decoded?.signer_key).toBe(`0x${"ab".repeat(33)}`);
		expect(decoded?.aggregated_amount_ustx).toBeNull();
	});

	test("stack-aggregation-commit: returns (ok bool) — index null", () => {
		const args = makeArgs(
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(87n),
			noneCV(),
			bufferCV(SIGNER_KEY_33),
			uintCV(500_000_000_000n),
			uintCV(1n),
		);
		const okBool = hex(serializeCV(responseOkCV(trueCV())));
		const row = fixtureTx({
			function_name: "stack-aggregation-commit",
			function_args: args,
			raw_result: okBool,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.aggregated_signer_index).toBeNull();
		expect(decoded?.reward_cycle).toBe(87);
	});

	test("stack-aggregation-increase populates amount + reward_cycle", () => {
		const args = makeArgs(
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(87n),
			uintCV(25_000_000n),
			bufferCV(SIGNER_KEY_33),
			noneCV(),
			uintCV(500_000_000n),
			uintCV(1n),
		);
		const row = fixtureTx({
			function_name: "stack-aggregation-increase",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.amount_ustx).toBe("25000000");
		expect(decoded?.reward_cycle).toBe(87);
		expect(decoded?.signer_key).toBe(`0x${"ab".repeat(33)}`);
	});

	test("set-signer-key-authorization captures topic + allowed + period", () => {
		const args = makeArgs(
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(12n), // period
			uintCV(87n), // reward-cycle
			stringAsciiCV("stack-stx"),
			bufferCV(SIGNER_KEY_33),
			boolCV(true), // allowed
			uintCV(500_000_000_000n),
			uintCV(42n),
		);
		const row = fixtureTx({
			function_name: "set-signer-key-authorization",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.auth_period).toBe(12);
		expect(decoded?.reward_cycle).toBe(87);
		expect(decoded?.auth_topic).toBe("stack-stx");
		expect(decoded?.auth_allowed).toBe(true);
		expect(decoded?.signer_key).toBe(`0x${"ab".repeat(33)}`);
		expect(decoded?.auth_id).toBe("42");
	});

	test("set-signer-key-authorization with allowed=false (revocation)", () => {
		const args = makeArgs(
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(12n),
			uintCV(87n),
			stringAsciiCV("stack-stx"),
			bufferCV(SIGNER_KEY_33),
			falseCV(),
			uintCV(0n),
			uintCV(0n),
		);
		const row = fixtureTx({
			function_name: "set-signer-key-authorization",
			function_args: args,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.auth_allowed).toBe(false);
	});

	test("failed call (response err) lands with base fields only", () => {
		const args = makeArgs(
			uintCV(100n),
			poxAddrCV(0x04, POX_HASHBYTES_20),
			uintCV(902_481n),
			uintCV(6n),
			noneCV(),
			bufferCV(SIGNER_KEY_33),
			uintCV(200n),
			uintCV(1n),
		);
		const errResult = hex(serializeCV(responseErrorCV(uintCV(7n))));
		const row = fixtureTx({
			function_name: "stack-stx",
			function_args: args,
			raw_result: errResult,
		});
		const decoded = decodePox4Tx(row);
		expect(decoded?.result_ok).toBe(false);
		expect(decoded?.amount_ustx).toBeNull();
		expect(decoded?.lock_period).toBeNull();
		expect(decoded?.signer_key).toBeNull();
		expect(decoded?.caller).toBe(CALLER);
		expect(decoded?.function_name).toBe("stack-stx");
	});
});
