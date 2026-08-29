import { describe, expect, test } from "bun:test";
import { EMPTY_RANGE_EVENT_INDEX_SENTINEL } from "@secondlayer/shared";
import type { Subscription } from "@secondlayer/shared/db";
import type { SubgraphDefinition } from "../types.ts";
import {
	boundSourceTip,
	committedHeight,
	decoderBoundTip,
	decoderNameForEventType,
	decoderNamesForSubgraph,
} from "./decoder-bound.ts";
import { referencedDecoderNames } from "./trigger-evaluator.ts";

function chainSub(triggers: Array<Record<string, unknown>>): Subscription {
	return { kind: "chain", triggers } as unknown as Subscription;
}

function subgraphDef(
	sources: Record<string, { type: string }>,
): SubgraphDefinition {
	return { name: "t", sources } as unknown as SubgraphDefinition;
}

/**
 * Minimal Kysely stub: records the IN-list and returns canned checkpoints
 * for names present in the map.
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
				.map((n) => ({ decoder_name: n, last_cursor: checkpoints[n] }));
		},
	};
	return {
		// biome-ignore lint/suspicious/noExplicitAny: Kysely stub
		db: qb as any,
		requested: () => requested,
	};
}

describe("decoder name mapping", () => {
	test("print_event maps to decode.print.v1 only", () => {
		expect(
			referencedDecoderNames([
				chainSub([{ type: "print_event", contractId: "*" }]),
			]),
		).toEqual(["decode.print.v1"]);
	});

	test("ft_transfer maps to decode.ft_transfer.v1 only", () => {
		expect(
			referencedDecoderNames([
				chainSub([{ type: "ft_transfer", assetIdentifier: "*" }]),
			]),
		).toEqual(["decode.ft_transfer.v1"]);
	});

	test("contract_call expands to every generic event decoder", () => {
		const names = referencedDecoderNames([
			chainSub([{ type: "contract_call" }]),
		]);
		expect(names).toContain("decode.print.v1");
		expect(names).toContain("decode.ft_transfer.v1");
		expect(names).toContain("decode.stx_transfer.v1");
		expect(names).not.toContain("decode.pox4.v1");
	});

	test("sBTC-only chain sub references no event decoders", () => {
		expect(
			referencedDecoderNames([chainSub([{ type: "sbtc_deposit" }])]),
		).toEqual([]);
	});

	test("print subgraph maps to decode.print.v1", () => {
		expect(
			decoderNamesForSubgraph(subgraphDef({ prints: { type: "print_event" } })),
		).toEqual(["decode.print.v1"]);
	});

	test("decoderNameForEventType follows decode.<type>.v1", () => {
		expect(decoderNameForEventType("print")).toBe("decode.print.v1");
	});
});

describe("committedHeight", () => {
	test("empty-range sentinel means the block is fully committed", () => {
		expect(committedHeight(`8864633:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`)).toBe(
			8_864_633,
		);
	});

	test("mid-block cursor floors to H-1", () => {
		expect(committedHeight("8864633:620")).toBe(8_864_632);
	});

	test("height 0 mid-block clamps at 0", () => {
		expect(committedHeight("0:1")).toBe(0);
	});

	test("absent or unparseable cursors are null", () => {
		expect(committedHeight(null)).toBeNull();
		expect(committedHeight("")).toBeNull();
		expect(committedHeight("not-a-cursor")).toBeNull();
	});
});

describe("decoderBoundTip", () => {
	test("print behind ft: floor is print; pox4 is not queried", async () => {
		const fake = fakeSourceDb({
			"decode.print.v1": `8864633:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
			"decode.ft_transfer.v1": `8864861:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
			"decode.pox4.v1": `8000000:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
		});
		const names = referencedDecoderNames([
			chainSub([{ type: "print_event", contractId: "*market*" }]),
		]);
		expect(names).toEqual(["decode.print.v1"]);
		await expect(
			decoderBoundTip(names, { sourceDb: fake.db }),
		).resolves.toEqual({ kind: "height", height: 8_864_633 });
		expect(fake.requested()).toEqual(["decode.print.v1"]);
	});

	test("mid-block print trails a finished ft_transfer", async () => {
		const fake = fakeSourceDb({
			"decode.print.v1": "8864633:620",
			"decode.ft_transfer.v1": `8864861:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
		});
		await expect(
			decoderBoundTip(["decode.print.v1", "decode.ft_transfer.v1"], {
				sourceDb: fake.db,
			}),
		).resolves.toEqual({ kind: "height", height: 8_864_632 });
	});

	test("empty names are unbounded (sBTC-only / no sources)", async () => {
		const fake = fakeSourceDb({ "decode.print.v1": "1:0" });
		await expect(decoderBoundTip([], { sourceDb: fake.db })).resolves.toEqual({
			kind: "unbounded",
		});
		expect(fake.requested()).toEqual([]);
	});

	test("missing referenced checkpoint stalls", async () => {
		const fake = fakeSourceDb({
			"decode.ft_transfer.v1": `10:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
		});
		await expect(
			decoderBoundTip(["decode.print.v1"], { sourceDb: fake.db }),
		).resolves.toEqual({
			kind: "stall",
			missing: ["decode.print.v1"],
		});
	});

	test("unparseable checkpoint stalls", async () => {
		const fake = fakeSourceDb({ "decode.print.v1": "nope" });
		await expect(
			decoderBoundTip(["decode.print.v1"], { sourceDb: fake.db }),
		).resolves.toEqual({
			kind: "stall",
			missing: ["decode.print.v1"],
		});
	});
});

describe("boundSourceTip", () => {
	test("min of raw tip and decoder floor", async () => {
		const fake = fakeSourceDb({
			"decode.print.v1": `100:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
		});
		await expect(
			boundSourceTip(200, ["decode.print.v1"], { sourceDb: fake.db }),
		).resolves.toEqual({ ok: true, tip: 100, floor: 100 });
	});

	test("raw tip below floor is unchanged", async () => {
		const fake = fakeSourceDb({
			"decode.print.v1": `200:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
		});
		await expect(
			boundSourceTip(50, ["decode.print.v1"], { sourceDb: fake.db }),
		).resolves.toEqual({ ok: true, tip: 50, floor: 200 });
	});

	test("unbounded names pass the raw tip through", async () => {
		await expect(boundSourceTip(9_000, [])).resolves.toEqual({
			ok: true,
			tip: 9_000,
			floor: null,
		});
	});

	test("stall surfaces missing names", async () => {
		const fake = fakeSourceDb({});
		await expect(
			boundSourceTip(9_000, ["decode.print.v1"], { sourceDb: fake.db }),
		).resolves.toEqual({ ok: false, missing: ["decode.print.v1"] });
	});
});
