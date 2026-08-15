import { describe, expect, test } from "bun:test";
import { FLOORS, preflightResources } from "./guardrails.ts";

describe("resource guardrails", () => {
	test("constrained fixtures fail early", () => {
		const low = preflightResources(
			{ ramMb: 512, diskGb: 10, postgresMaxConnections: 10 },
			"external",
		);
		expect(low.ok).toBe(false);
		if (!low.ok) expect(low.errors.length).toBeGreaterThan(0);
	});

	test("a box too small for mainnet history is refused", () => {
		// The bug this guards: 120 GB used to PASS, while the reference mainnet
		// index measured 504 GB. An operator sized from that answer filled the
		// disk partway through their first bootstrap.
		const undersized = preflightResources(
			{ ramMb: 8192, diskGb: 120, postgresMaxConnections: 100 },
			"external",
			"mainnet",
		);
		expect(undersized.ok).toBe(false);
		if (!undersized.ok) {
			expect(undersized.errors.some((e) => e.includes("disk"))).toBe(true);
		}
	});

	test("a realistically sized mainnet box is accepted", () => {
		const ok = preflightResources(
			{ ramMb: 8192, diskGb: 800, postgresMaxConnections: 100 },
			"external",
			"mainnet",
		);
		expect(ok.ok).toBe(true);
	});

	test("testnet is not held to the mainnet disk floor", () => {
		// Mainnet history is orders of magnitude larger; one floor for both would
		// lock testnet operators out of boxes that are entirely adequate.
		const ok = preflightResources(
			{ ramMb: 8192, diskGb: 120, postgresMaxConnections: 100 },
			"external",
			"testnet",
		);
		expect(ok.ok).toBe(true);
		expect(FLOORS.appDiskGb).toBeLessThan(FLOORS.mainnetAppDiskGb);
	});

	test("an unspecified network gets the strictest floor", () => {
		// Erring toward "you need more disk than you do" is recoverable; the
		// opposite silently strands the operator mid-bootstrap.
		const implicit = preflightResources(
			{ ramMb: 8192, diskGb: 120, postgresMaxConnections: 100 },
			"external",
		);
		expect(implicit.ok).toBe(false);
	});

	test("growth estimates are measured, and decoding costs more than core", () => {
		const ok = preflightResources(
			{ ramMb: 8192, diskGb: 800, postgresMaxConnections: 100 },
			"external",
			"mainnet",
		);
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.estimates.diskGbPer100kBlocks).toBe(3);
			expect(ok.estimates.diskGbPer100kBlocksDecoded).toBeGreaterThan(
				ok.estimates.diskGbPer100kBlocks,
			);
			// Sanity against the measurement: 3 GB/100k over ~8.77M blocks is the
			// ~247 GB of core datasets actually on disk.
			expect(ok.estimates.diskGbPer100kBlocks * 87.7).toBeGreaterThan(200);
		}
	});

	test("the bundled-node floor exceeds the components we measured", () => {
		// Stacks chainstate alone measured 1.3 TB and the index adds ~0.5 TB, so
		// the old 1.5 TB floor was below the sum of two known parts.
		expect(FLOORS.mainnetFullDiskGb).toBeGreaterThan(1800);
	});
});
