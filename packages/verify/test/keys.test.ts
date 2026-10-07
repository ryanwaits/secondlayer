import { describe, expect, test } from "bun:test";
import { uintCV } from "@secondlayer/stacks/clarity";
import { dataVarKey, ftBalanceKey, mapEntryKey } from "../src/index.ts";
import { type ProofFixture, listFixtures, readJson } from "./fixtures.ts";

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const POOL =
	"SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15";

describe("MARF keys", () => {
	test("ftBalanceKey matches mainnet sBTC balance keys for standard and contract holders", () => {
		const keys = listFixtures("proofs").map(
			(f) => readJson<ProofFixture>(`proofs/${f}`).key,
		);
		expect(keys).toContain(ftBalanceKey(SBTC, "sbtc-token", POOL));
		expect(keys).toContain(
			ftBalanceKey(
				SBTC,
				"sbtc-token",
				"SP1GBRTAXY96ZDYRQY4GR0M9JTXVYD2FGFRGV60FJ",
			),
		);
	});

	test("contract holder serializes as serde PrincipalData::Contract", () => {
		expect(ftBalanceKey(SBTC, "sbtc-token", POOL)).toBe(
			`vm::${SBTC}::2::sbtc-token::{"Contract":{"issuer":[20,[95,62,194,191,151,51,174,55,157,191,229,87,157,101,214,203,245,136,101,150]],"name":"dlmm-pool-stx-sbtc-v-1-bps-15"}}`,
		);
	});

	test("dataVarKey uses StoreType::Variable", () => {
		expect(dataVarKey(POOL, "active-bin-id")).toBe(
			`vm::${POOL}::1::active-bin-id`,
		);
	});

	test("mapEntryKey appends the consensus-serialized key", () => {
		expect(mapEntryKey(POOL, "balances-at-bin", uintCV(555))).toBe(
			`vm::${POOL}::0::balances-at-bin::010000000000000000000000000000022b`,
		);
	});
});
