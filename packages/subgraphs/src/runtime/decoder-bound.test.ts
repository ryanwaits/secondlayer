import { afterAll, describe, expect, test } from "bun:test";
import { EMPTY_RANGE_EVENT_INDEX_SENTINEL } from "@secondlayer/shared";
import type { Webhook } from "@secondlayer/shared/db";
import type { SubgraphDefinition } from "../types.ts";
import {
	boundSourceTip,
	committedHeight,
	decoderBoundTip,
	decoderNameForEventType,
	decoderNamesForSubgraph,
	usesDecodedIndexPlane,
} from "./decoder-bound.ts";
import { referencedDecoderNames } from "./trigger-evaluator.ts";

function chainSub(triggers: Array<Record<string, unknown>>): Webhook {
	return { kind: "chain", triggers } as unknown as Webhook;
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

	test("map_set chain sub references no event decoders", () => {
		expect(referencedDecoderNames([chainSub([{ type: "map_set" }])])).toEqual(
			[],
		);
	});

	test("print subgraph maps to decode.print.v1", () => {
		expect(
			decoderNamesForSubgraph(subgraphDef({ prints: { type: "print_event" } })),
		).toEqual(["decode.print.v1"]);
	});

	test("decoderNameForEventType follows decode.<type>.v1", () => {
		expect(decoderNameForEventType("print")).toBe("decode.print.v1");
	});

	test("vm-only subgraph references no event decoders", () => {
		expect(
			decoderNamesForSubgraph(subgraphDef({ maps: { type: "map_set" } })),
		).toEqual([]);
	});

	test("mixed print + map_set stays on the print decoder", () => {
		expect(
			decoderNamesForSubgraph(
				subgraphDef({
					prints: { type: "print_event" },
					maps: { type: "map_set" },
				}),
			),
		).toEqual(["decode.print.v1"]);
	});
});

describe("usesDecodedIndexPlane", () => {
	const prev = process.env.SUBGRAPH_SOURCE;
	const printSg = subgraphDef({ prints: { type: "print_event" } });

	afterAll(() => {
		if (prev === undefined) delete process.env.SUBGRAPH_SOURCE;
		else process.env.SUBGRAPH_SOURCE = prev;
	});

	test("postgres tap (default) is not decoded-index", () => {
		delete process.env.SUBGRAPH_SOURCE;
		expect(usesDecodedIndexPlane(printSg)).toBe(false);
	});

	test("streams-index eligible subgraph is decoded-index", () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		expect(usesDecodedIndexPlane(printSg)).toBe(true);
	});

	test("streams-index array-style sources stay on the postgres tap", () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		const arraySg = {
			name: "t",
			sources: [{ type: "print_event" }],
		} as unknown as SubgraphDefinition;
		expect(usesDecodedIndexPlane(arraySg)).toBe(false);
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

describe("decoderBoundTip (remote index status)", () => {
	const prevSource = process.env.SUBGRAPH_SOURCE;
	const prevUrl = process.env.SUBGRAPH_INDEX_API_URL;

	function setRemoteEnv() {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		process.env.SUBGRAPH_INDEX_API_URL = "https://api.secondlayer.tools";
	}

	afterAll(() => {
		if (prevSource === undefined) delete process.env.SUBGRAPH_SOURCE;
		else process.env.SUBGRAPH_SOURCE = prevSource;
		if (prevUrl === undefined) delete process.env.SUBGRAPH_INDEX_API_URL;
		else process.env.SUBGRAPH_INDEX_API_URL = prevUrl;
	});

	test("a stalled UNREFERENCED decoder never gates a referenced one (the invariant this mode must preserve)", async () => {
		setRemoteEnv();
		try {
			// print hasn't moved past 100; the webhook only reads stx_transfer,
			// which is at 200. Bounding by the global cross-decoder floor would
			// wrongly stall this webhook on a decoder it never reads.
			await expect(
				decoderBoundTip(["decode.stx_transfer.v1"], {
					remoteDecodedHeights: { stx_transfer: 200, print: 100 },
				}),
			).resolves.toEqual({ kind: "height", height: 200 });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("a REFERENCED decoder missing from decoded_heights stalls", async () => {
		setRemoteEnv();
		try {
			await expect(
				decoderBoundTip(["decode.stx_transfer.v1"], {
					remoteDecodedHeights: { print: 100 },
				}),
			).resolves.toEqual({
				kind: "stall",
				missing: ["decode.stx_transfer.v1"],
			});
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("a REFERENCED decoder present but null (no checkpoint yet) stalls", async () => {
		setRemoteEnv();
		try {
			await expect(
				decoderBoundTip(["decode.stx_transfer.v1"], {
					remoteDecodedHeights: { stx_transfer: null },
				}),
			).resolves.toEqual({
				kind: "stall",
				missing: ["decode.stx_transfer.v1"],
			});
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("min across several referenced decoders, unreferenced ones still ignored", async () => {
		setRemoteEnv();
		try {
			await expect(
				decoderBoundTip(["decode.ft_transfer.v1", "decode.stx_transfer.v1"], {
					remoteDecodedHeights: {
						ft_transfer: 300,
						stx_transfer: 200,
						print: 50,
					},
				}),
			).resolves.toEqual({ kind: "height", height: 200 });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("decoded_heights absent entirely (older server) falls back to unbounded, not a stall", async () => {
		setRemoteEnv();
		try {
			// rawTip (whatever the caller passes to boundSourceTip) is already the
			// conservative cross-decoder floor server-side, so trusting it as-is
			// IS the fallback — no separate request to reconstruct it here.
			await expect(
				decoderBoundTip(["decode.print.v1", "decode.ft_transfer.v1"]),
			).resolves.toEqual({ kind: "unbounded" });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("zero referenced decoders (VM-only triggers) stay unbounded regardless of decoded_heights", async () => {
		setRemoteEnv();
		try {
			await expect(
				decoderBoundTip([], { remoteDecodedHeights: { print: 0 } }),
			).resolves.toEqual({ kind: "unbounded" });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("remote mode never touches sourceDb even when one is passed", async () => {
		setRemoteEnv();
		try {
			const fake = fakeSourceDb({});
			const spy = fake.db as unknown as { selectFrom: () => never };
			spy.selectFrom = () => {
				throw new Error("remote mode must not query decoder_checkpoints");
			};
			await expect(
				decoderBoundTip(["decode.print.v1"], {
					sourceDb: fake.db,
					remoteDecodedHeights: { print: 100 },
				}),
			).resolves.toEqual({ kind: "height", height: 100 });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
	});

	test("local mode (no SUBGRAPH_INDEX_API_URL) still reads Postgres", async () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		delete process.env.SUBGRAPH_INDEX_API_URL;
		try {
			const fake = fakeSourceDb({
				"decode.print.v1": `100:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
			});
			await expect(
				decoderBoundTip(["decode.print.v1"], { sourceDb: fake.db }),
			).resolves.toEqual({ kind: "height", height: 100 });
		} finally {
			delete process.env.SUBGRAPH_SOURCE;
		}
	});

	test("SUBGRAPH_SOURCE unset still reads Postgres even with SUBGRAPH_INDEX_API_URL set", async () => {
		delete process.env.SUBGRAPH_SOURCE;
		process.env.SUBGRAPH_INDEX_API_URL = "https://api.secondlayer.tools";
		try {
			const fake = fakeSourceDb({
				"decode.print.v1": `100:${EMPTY_RANGE_EVENT_INDEX_SENTINEL}`,
			});
			await expect(
				decoderBoundTip(["decode.print.v1"], { sourceDb: fake.db }),
			).resolves.toEqual({ kind: "height", height: 100 });
		} finally {
			delete process.env.SUBGRAPH_INDEX_API_URL;
		}
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
