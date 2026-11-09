import { describe, expect, test } from "bun:test";
import { isPoxContractId, mainnetPoxContractAt } from "./pox-contracts.ts";

const BOOT = "SP000000000000000000002Q6VF78";

describe("mainnetPoxContractAt", () => {
	// Edges are the stacks-core mainnet epoch heights; the inner points are the
	// first and last burn heights of real stored locks per contract.
	test.each([
		[666_068, "pox"],
		[781_446, "pox"],
		[781_550, "pox"],
		[781_551, "pox-2"],
		[787_544, "pox-2"],
		[789_249, "pox-2"],
		[789_250, "pox-3"],
		[840_099, "pox-3"],
		[840_360, "pox-4"],
		[960_199, "pox-4"],
		[960_230, "pox-5"],
		[975_196, "pox-5"],
	])("burn height %d locks under %s", (burnHeight, name) => {
		expect(mainnetPoxContractAt(burnHeight)).toBe(`${BOOT}.${name}`);
	});
});

describe("isPoxContractId", () => {
	test("matches boot PoX contracts on any network, not look-alikes", () => {
		expect(isPoxContractId(`${BOOT}.pox-4`)).toBe(true);
		expect(isPoxContractId(`${BOOT}.pox`)).toBe(true);
		expect(isPoxContractId("ST000000000000000000002AMW42H.pox-5")).toBe(true);
		expect(isPoxContractId(`${BOOT}.pox-4-helper`)).toBe(false);
		expect(isPoxContractId("SP1.token")).toBe(false);
	});
});
