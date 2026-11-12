import { afterEach, describe, expect, test } from "bun:test";
import { DATA_TOPICS, dataTopic } from "./data-topics";
import {
	datasetJsonLd,
	getPoxStats,
	getSbtcStats,
	getTopicStats,
	liveDescription,
	parsePoxStats,
	parseSbtcStats,
	satsToBtc,
	sharePct,
	signerName,
	stripItems,
	ustxToStx,
} from "./protocol-stats";

const STAMP = {
	tip: { block_height: 9_469_882, lag_seconds: 2 },
	generated_at: "2026-11-12T12:00:00.000Z",
};

const SBTC_BODY = {
	summary: {
		total_deposits: 69_849,
		total_withdrawals_accepted: 9_000,
		total_withdrawals_rejected: 12,
		sbtc_supply_sats: "248003000000",
	},
	...STAMP,
};

const POX_BODY = {
	current: {
		reward_cycle: 147,
		end_burn_height: 976_849,
		total_stacked_ustx: "400000000000000",
		stakers: 3_454,
		signers_in_set: 36,
		bond_total_sats: "150000000",
	},
	signers: [
		{
			signer: "SP1N3G8X1X2FTZFD5Y9MAT8KHE1FVBE2GPKAPVSSV.meria-signer-manager",
			delegated_ustx: "100000000000000",
			in_set: true,
		},
		{ signer: "SP2ABCDEF", delegated_ustx: "0", in_set: false },
	],
	...STAMP,
};

describe("formatters", () => {
	test("micro-STX become whole STX without float drift", () => {
		expect(ustxToStx("453200000000000")).toBe(453_200_000);
		expect(ustxToStx("1999999")).toBe(1);
	});

	test("sats become BTC", () => {
		expect(satsToBtc("248003000000")).toBe(2480.03);
	});

	test("share is one decimal and survives an empty total", () => {
		expect(sharePct("25000000", "100000000")).toBe(25);
		expect(sharePct("1", "3")).toBe(33.3);
		expect(sharePct("5", "0")).toBe(0);
	});

	test("a signer reads as its contract name, else a short principal", () => {
		expect(signerName("SP1N3G8X.meria-signer-manager")).toBe(
			"meria-signer-manager",
		);
		expect(signerName("SP1N3G8X1X2FTZFD5Y9MAT8KHE1FVBE2GPKAPVSSV")).toBe(
			"SP1N3G…VSSV",
		);
		expect(signerName("SP2ABC")).toBe("SP2ABC");
	});
});

describe("parsing the keyless payloads", () => {
	test("sbtc payload becomes the strip numbers and the tip stamp", () => {
		expect(parseSbtcStats(SBTC_BODY)).toEqual({
			supplyBtc: 2480.03,
			deposits: 69_849,
			withdrawalsAccepted: 9_000,
			withdrawalsRejected: 12,
			blockHeight: 9_469_882,
			generatedAt: "2026-11-12T12:00:00.000Z",
		});
	});

	test("sbtc without a supply is not shown half-filled", () => {
		const body = {
			...SBTC_BODY,
			summary: { ...SBTC_BODY.summary, sbtc_supply_sats: null },
		};
		expect(parseSbtcStats(body)).toBeNull();
		expect(parseSbtcStats({})).toBeNull();
		expect(parseSbtcStats(null)).toBeNull();
	});

	test("pox payload becomes the cycle strip and a signer table", () => {
		const stats = parsePoxStats(POX_BODY);
		expect(stats?.cycle).toBe(147);
		expect(stats?.endBurnHeight).toBe(976_849);
		expect(stats?.totalStackedStx).toBe(400_000_000);
		expect(stats?.bondBtc).toBe(1.5);
		expect(stats?.signers[0]).toEqual({
			principal:
				"SP1N3G8X1X2FTZFD5Y9MAT8KHE1FVBE2GPKAPVSSV.meria-signer-manager",
			name: "meria-signer-manager",
			stackedStx: 100_000_000,
			sharePct: 25,
			inSet: true,
		});
		expect(stats?.signers[1]?.inSet).toBe(false);
	});

	test("pox before the first cycle, or with a bad signer row, is null", () => {
		expect(parsePoxStats({ ...POX_BODY, current: null })).toBeNull();
		expect(parsePoxStats({ ...POX_BODY, signers: [{ signer: 1 }] })).toBeNull();
	});
});

describe("fetching", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("a good response parses", async () => {
		globalThis.fetch = (async () =>
			Response.json(SBTC_BODY)) as unknown as typeof fetch;
		expect((await getSbtcStats())?.deposits).toBe(69_849);
	});

	test("an error status, a throw and bad JSON all read as null", async () => {
		globalThis.fetch = (async () =>
			new Response("nope", { status: 503 })) as unknown as typeof fetch;
		expect(await getPoxStats()).toBeNull();
		globalThis.fetch = (async () => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		expect(await getSbtcStats()).toBeNull();
		globalThis.fetch = (async () =>
			new Response("<html>", { status: 200 })) as unknown as typeof fetch;
		expect(await getPoxStats()).toBeNull();
	});

	test("a topic with no live numbers never fetches", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return Response.json({});
		}) as unknown as typeof fetch;
		const runes = DATA_TOPICS.find((topic) => topic.slug === "runes");
		if (!runes) throw new Error("runes topic missing");
		expect(await getTopicStats(runes)).toBeNull();
		expect(called).toBe(false);
	});
});

describe("strip numbers", () => {
	test("sbtc shows supply, deposits and both withdrawal outcomes", () => {
		const data = parseSbtcStats(SBTC_BODY);
		if (!data) throw new Error("fixture");
		const { items, sub } = stripItems({ kind: "sbtc", data });
		expect(items.map((item) => item.label)).toEqual([
			"sBTC supply",
			"Deposits",
			"Withdrawals accepted",
			"Withdrawals rejected",
		]);
		expect(items[0]).toMatchObject({ value: 2480.03, unit: "BTC" });
		expect(sub).toBeNull();
	});

	test("pox names the cycle and where it ends", () => {
		const data = parsePoxStats(POX_BODY);
		if (!data) throw new Error("fixture");
		const { items, sub } = stripItems({ kind: "pox", data });
		expect(items).toHaveLength(4);
		expect(items[0]).toMatchObject({ value: 400_000_000, unit: "STX" });
		expect(sub).toBe("Cycle 147 · ends at Bitcoin block 976,849");
	});
});

describe("page metadata", () => {
	const sbtc = dataTopic("sbtc");
	const pox = dataTopic("pox5");
	if (!sbtc || !pox) throw new Error("topics missing");

	test("the description carries one live number, else the registry copy", () => {
		const data = parseSbtcStats(SBTC_BODY);
		if (!data) throw new Error("fixture");
		expect(liveDescription(sbtc, { kind: "sbtc", data })).toContain(
			"2,480 sBTC across 69,849 deposits",
		);
		expect(liveDescription(sbtc, null)).toBe(sbtc.description);
		const poxData = parsePoxStats(POX_BODY);
		if (!poxData) throw new Error("fixture");
		const text = liveDescription(pox, { kind: "pox", data: poxData });
		expect(text).toContain("400,000,000 STX");
		expect(text.length).toBeLessThanOrEqual(160);
	});

	test("the Dataset names its freshness and the keyless distribution", () => {
		const data = parsePoxStats(POX_BODY);
		if (!data) throw new Error("fixture");
		const ld = datasetJsonLd(pox, { kind: "pox", data }, "/data/pox5");
		expect(ld["@type"]).toBe("Dataset");
		expect(ld.dateModified).toBe("2026-11-12T12:00:00.000Z");
		expect(ld.distribution).toMatchObject({
			contentUrl: "https://api.secondlayer.tools/public/data/pox",
		});
	});
});
