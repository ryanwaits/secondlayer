import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	_resetBitcoinDbForTests,
	_resetBitcoinTipCacheForTests,
	getBitcoinTip,
	isBitcoinConfigured,
	parseRuneRef,
	readBtcReorgs,
} from "./db.ts";

describe("parseRuneRef", () => {
	test("parses an id", () => {
		expect(parseRuneRef("840000:3")).toEqual({ id: "840000:3" });
	});

	test("normalizes a leading-zero id to the canonical key", () => {
		expect(parseRuneRef("0840000:03")).toEqual({ id: "840000:3" });
	});

	test("parses a spaced (bullet) name", () => {
		const ref = parseRuneRef("DOG•GO•TO•THE•MOON");
		expect(ref).toHaveProperty("rune");
		expect((ref as { rune: bigint }).rune).toBe(
			(parseRuneRef("dog.go.to.the.moon") as { rune: bigint }).rune,
		);
	});

	test("dotted, lowercase, and unspaced names all resolve to the same rune", () => {
		const dotted = parseRuneRef("dog.go.to.the.moon") as { rune: bigint };
		const spaced = parseRuneRef("dog go to the moon") as { rune: bigint };
		const bare = parseRuneRef("doggotothemoon") as { rune: bigint };
		expect(dotted.rune).toBe(spaced.rune);
		expect(dotted.rune).toBe(bare.rune);
	});

	test("garbage input throws ValidationError", () => {
		expect(() => parseRuneRef("!!!not-a-rune###")).toThrow(ValidationError);
	});

	test("a malformed id-shaped string is treated as a name and still throws", () => {
		expect(() => parseRuneRef("840000:3:5")).toThrow(ValidationError);
	});
});

describe("isBitcoinConfigured / getBitcoinTip (unconfigured)", () => {
	const prevUrl = process.env.BITCOIN_DATABASE_URL;

	beforeEach(() => {
		delete process.env.BITCOIN_DATABASE_URL;
		_resetBitcoinDbForTests();
		_resetBitcoinTipCacheForTests();
	});

	afterEach(() => {
		if (prevUrl === undefined) delete process.env.BITCOIN_DATABASE_URL;
		else process.env.BITCOIN_DATABASE_URL = prevUrl;
		_resetBitcoinDbForTests();
		_resetBitcoinTipCacheForTests();
	});

	test("reports unconfigured when BITCOIN_DATABASE_URL is unset", () => {
		expect(isBitcoinConfigured()).toBe(false);
	});

	test("getBitcoinTip returns the zero tip with no DB", async () => {
		const tip = await getBitcoinTip(undefined);
		expect(tip).toEqual({
			block_height: 0,
			finalized_height: 0,
			lag_seconds: 0,
		});
	});

	test("readBtcReorgs returns empty with no DB", async () => {
		const reorgs = await readBtcReorgs(0, 1000, undefined);
		expect(reorgs).toEqual([]);
	});
});
