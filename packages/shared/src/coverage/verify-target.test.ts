import { describe, expect, test } from "bun:test";
import {
	VERIFY_EXIT,
	datasetMatchesTarget,
	parseVerifyTarget,
	reportVerify,
} from "./verify-target.ts";

describe("verify targets", () => {
	test("parses all, raw, decode, subgraph", () => {
		expect(parseVerifyTarget(undefined)).toEqual({ kind: "raw" });
		expect(parseVerifyTarget("all")).toEqual({ kind: "all" });
		expect(parseVerifyTarget("decode:ft_transfer")).toEqual({
			kind: "decode",
			name: "ft_transfer",
		});
		expect(parseVerifyTarget("subgraph:sbtc")).toEqual({
			kind: "subgraph",
			name: "sbtc",
		});
	});

	test("exit codes are stable across library and CLI", () => {
		expect(VERIFY_EXIT.CLEAN).toBe(0);
		expect(VERIFY_EXIT.DIVERGED).toBe(1);
		expect(VERIFY_EXIT.UNANCHORED).toBe(2);
		expect(reportVerify({ target: { kind: "raw" } }).exit).toBe(0);
		expect(reportVerify({ target: { kind: "all" }, diverged: true }).exit).toBe(
			1,
		);
		expect(
			reportVerify({
				target: { kind: "decode", name: "pox4" },
				anchored: false,
			}).exit,
		).toBe(2);
	});

	test("dataset filter: raw vs decode vs subgraph vs all", () => {
		expect(datasetMatchesTarget("blocks", { kind: "raw" })).toBe(true);
		expect(datasetMatchesTarget("ft_transfer", { kind: "raw" })).toBe(false);
		expect(
			datasetMatchesTarget("decode:ft_transfer", {
				kind: "decode",
				name: "ft_transfer",
			}),
		).toBe(true);
		expect(
			datasetMatchesTarget("sbtc_events", { kind: "subgraph", name: "sbtc" }),
		).toBe(true);
		expect(datasetMatchesTarget("blocks", { kind: "all" })).toBe(true);
	});
});
