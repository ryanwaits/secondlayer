import { afterEach, describe, expect, test } from "bun:test";
import { dataTopic } from "./data-topics";
import {
	datasetJsonLd,
	formatRuneAmount,
	getPoxStats,
	getRunesStats,
	getSbtcStats,
	getTopicStats,
	liveDescription,
	liveExamples,
	liveOutput,
	parsePoxStats,
	parseRunesStats,
	parseSbtcStats,
	satsToBtc,
	sharePct,
	signerName,
	stripItems,
	tellSignersApart,
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

const RUNES_BODY = {
	most_minted: [
		{
			id: "1:0",
			spaced_name: "UNCOMMON•GOODS",
			symbol: "⧉",
			mints: "173834713",
			supply: "173834713",
			divisibility: 0,
		},
		{
			id: "840000:1",
			spaced_name: "Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z",
			symbol: null,
			mints: "1111111",
			supply: "11111111100",
			divisibility: 2,
		},
	],
	tip: { block_height: 975_574 },
	generated_at: "2026-11-12T12:00:00.000Z",
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

describe("signers with the same contract name", () => {
	test("get distinct display names while a unique one is unchanged", () => {
		const row = (principal: string) => ({
			principal,
			name: signerName(principal),
			stackedStx: 1,
			sharePct: 1,
			inSet: true,
		});
		const rows = tellSignersApart([
			row("SP3EP7SQFX61NZY44QSAEESZJMQ9YV9QWRY4YAP9A.signer-manager"),
			row("SP1N3G8X1X2FTZFD5Y9MAT8KHE1FVBE2GPKAPVSSV.signer-manager"),
			row("SP2ABCDEF1234.stacks-labs"),
		]);
		expect(rows[0]?.name).toBe("signer-manager · SP3…AP9A");
		expect(rows[1]?.name).toBe("signer-manager · SP1…VSSV");
		expect(rows[0]?.name).not.toBe(rows[1]?.name);
		expect(rows[2]?.name).toBe("stacks-labs");
		expect(rows[0]?.principal).toContain("SP3EP7");
	});
});

describe("parsing the keyless payloads", () => {
	test("sbtc payload becomes the strip numbers and the tip stamp", () => {
		expect(parseSbtcStats(SBTC_BODY)).toEqual({
			summary: SBTC_BODY.summary,
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

describe("runes payload", () => {
	test("rows keep their amounts as exact decimal strings", () => {
		const stats = parseRunesStats(RUNES_BODY);
		expect(stats?.blockHeight).toBe(975_574);
		expect(stats?.runes[0]).toEqual({
			id: "1:0",
			name: "UNCOMMON•GOODS",
			symbol: "⧉",
			mints: "173834713",
			supply: "173834713",
			divisibility: 0,
		});
		expect(stats?.runes[1]?.symbol).toBeNull();
	});

	test("an empty list or a bad row is not shown", () => {
		expect(parseRunesStats({ ...RUNES_BODY, most_minted: [] })).toBeNull();
		expect(
			parseRunesStats({ ...RUNES_BODY, most_minted: [{ id: "1:0" }] }),
		).toBeNull();
		expect(parseRunesStats(null)).toBeNull();
	});

	test("supply applies divisibility without float drift", () => {
		expect(formatRuneAmount("173834713", 0)).toBe("173,834,713");
		expect(formatRuneAmount("11111111100", 2)).toBe("111,111,111");
		expect(formatRuneAmount("12345", 2)).toBe("123.45");
		expect(formatRuneAmount("5", 8)).toBe("0.00000005");
		expect(formatRuneAmount("100000000000000000", 8)).toBe("1,000,000,000");
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

	test("the runes topic reads the keyless runes payload", async () => {
		let url = "";
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			url = String(input);
			return Response.json(RUNES_BODY);
		}) as unknown as typeof fetch;
		const runes = dataTopic("runes");
		if (!runes) throw new Error("runes topic missing");
		const stats = await getTopicStats(runes);
		expect(stats?.kind).toBe("runes");
		expect(url).toEndWith("/public/data/runes");
		expect((await getRunesStats())?.runes).toHaveLength(2);
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
	const runes = dataTopic("runes");
	if (!sbtc || !pox || !runes) throw new Error("topics missing");

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

	test("the runes description names the leader and stays short", () => {
		const data = parseRunesStats(RUNES_BODY);
		if (!data) throw new Error("fixture");
		const text = liveDescription(runes, { kind: "runes", data });
		expect(text).toContain("UNCOMMON•GOODS");
		expect(text).toContain("173,834,713 mints");
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

describe("picker examples", () => {
	const sbtc = dataTopic("sbtc");
	const pox = dataTopic("pox5");
	const runes = dataTopic("runes");
	if (!sbtc || !pox || !runes) throw new Error("topics missing");
	const sbtcStats = parseSbtcStats(SBTC_BODY);
	const poxStats = parsePoxStats(POX_BODY);
	const runesStats = parseRunesStats(RUNES_BODY);
	if (!sbtcStats || !poxStats || !runesStats) throw new Error("fixture");

	test("the sbtc No key output is the summary the command prints, supply marked", () => {
		const out = liveOutput({ kind: "sbtc", data: sbtcStats });
		expect(out).toContain("// !mark[/248003000000/]");
		const json = JSON.parse(
			out
				.split("\n")
				.filter((line) => !line.trim().startsWith("//"))
				.join("\n"),
		);
		expect(json).toEqual(SBTC_BODY.summary);
	});

	test("the pox No key output is exactly the jq projection", () => {
		const out = liveOutput({ kind: "pox", data: poxStats });
		const json = JSON.parse(
			out
				.split("\n")
				.filter((line) => !line.trim().startsWith("//"))
				.join("\n"),
		);
		expect(json).toEqual({
			reward_cycle: 147,
			total_stacked_ustx: "400000000000000",
			stakers: 3_454,
		});
	});

	test("the runes No key output is the first most-minted entry", () => {
		const out = liveOutput({ kind: "runes", data: runesStats });
		expect(out).toContain("// !mark[/173834713/]");
		expect(out).toContain('"spaced_name": "UNCOMMON•GOODS"');
	});

	test("the current cycle fills the pox examples, else the fallback", () => {
		const live = liveExamples(pox, { kind: "pox", data: poxStats });
		expect(live.ts.code).toContain("cycles.get(147)");
		expect(live.curl.code).toContain("/cycles/147");
		const next = liveExamples(pox, {
			kind: "pox",
			data: { ...poxStats, cycle: 150 },
		});
		expect(next.ts.code).toContain("cycles.get(150)");
		expect(next.curl.output).toContain('"reward_cycle": 150');
		const fallback = liveExamples(pox, null);
		expect(fallback.ts.code).toContain("cycles.get(147)");
		expect(fallback.free.output).toContain('"reward_cycle": 147');
		expect(`${fallback.ts.code}${fallback.curl.code}`).not.toContain("{cycle}");
	});

	test("without live numbers the registry sample stands in", () => {
		expect(liveExamples(sbtc, null).free.output).toBe(
			sbtc.examples.free.output,
		);
	});

	test("every topic has the keyless command and three recipes", () => {
		for (const topic of [sbtc, pox, runes]) {
			expect(topic.examples.free.code).toContain(
				`https://api.secondlayer.tools/public/data/${topic.stats}`,
			);
			expect(topic.recipes).toHaveLength(3);
		}
	});
});
