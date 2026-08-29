import { describe, expect, test } from "bun:test";
import type { Subscription } from "@secondlayer/shared/db";
import {
	decoderFloorHeight,
	lowestDecoderHeight,
	referencedDecoderNames,
} from "./trigger-evaluator.ts";

/** Minimal chain subscription with the given triggers. */
function chainSub(triggers: Array<Record<string, unknown>>): Subscription {
	return { kind: "chain", triggers } as unknown as Subscription;
}

/**
 * Fake source DB whose `decoder_checkpoints` query returns the canned cursor for
 * each requested decoder name — enough to exercise `decoderFloorHeight` without
 * a Postgres. Records nothing; just filters the `WHERE decoder_name IN (…)` set.
 */
function fakeSourceDb(checkpoints: Record<string, string | null>) {
	let requested: string[] = [];
	const qb = {
		selectFrom() {
			return qb;
		},
		select() {
			return qb;
		},
		where(_col: string, _op: string, names: string[]) {
			requested = names;
			return qb;
		},
		async execute() {
			return requested
				.filter((n) => n in checkpoints)
				.map((n) => ({ last_cursor: checkpoints[n] }));
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: minimal Kysely stub for the test
	return qb as any;
}

describe("chain evaluator decoder-progress floor (per-trigger)", () => {
	test("referencedDecoderNames maps triggers to only their decoders", () => {
		expect(
			referencedDecoderNames([chainSub([{ type: "print_event", contractId: "*" }])]),
		).toEqual(["decode.print.v1"]);
		expect(
			referencedDecoderNames([
				chainSub([{ type: "ft_transfer", assetIdentifier: "*" }]),
			]),
		).toEqual(["decode.ft_transfer.v1"]);
	});

	test("lowestDecoderHeight picks the min and skips absent/unparseable cursors", () => {
		// The race: print (8_864_633) trails ft_transfer (8_864_861) → floor = print.
		expect(
			lowestDecoderHeight(["8864861:2147483647", "8864633:620"]),
		).toBe(8_864_633);
		expect(lowestDecoderHeight(["8864861:0", null, ""])).toBe(8_864_861);
		expect(lowestDecoderHeight([null, undefined])).toBeNull();
		expect(lowestDecoderHeight([])).toBeNull();
	});

	test("floor for a print sub tracks print, ignoring a faster ft and a stalled pox4", async () => {
		// print behind ft (the race) AND a defunct pox4 stalled far back. The floor
		// must follow print (the only decoder this sub reads), NOT be dragged down
		// by pox4 (unsubscribed) nor float up to the ingestion-fast ft_transfer.
		const db = fakeSourceDb({
			"decode.print.v1": "8864633:620",
			"decode.ft_transfer.v1": "8864861:2147483647",
			"decode.pox4.v1": "8000000:2147483647",
		});
		const names = referencedDecoderNames([
			chainSub([{ type: "print_event", contractId: "*fakfun-market-registry*" }]),
		]);
		expect(names).toEqual(["decode.print.v1"]);
		await expect(decoderFloorHeight(names, { sourceDb: db })).resolves.toBe(
			8_864_633,
		);
	});

	test("no referenced decoders → null floor (caller falls back to raw tip)", async () => {
		const db = fakeSourceDb({ "decode.print.v1": "8864633:0" });
		await expect(decoderFloorHeight([], { sourceDb: db })).resolves.toBeNull();
	});
});
