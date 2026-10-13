import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import {
	parseRuneKinds,
	parseRuneSort,
	registerIndexCommand,
	runeBalanceSubject,
} from "./index-api.ts";

const ENV = [
	"INSTANCE_TOKEN",
	"SL_API_KEY",
	"SECONDLAYER_API_KEY",
	"SECONDLAYER_API_URL",
	"SL_API_URL",
] as const;

function program(): Command {
	const p = new Command();
	p.exitOverride();
	registerIndexCommand(p);
	return p;
}

describe("index runes", () => {
	let saved: Record<string, string | undefined>;
	let realFetch: typeof fetch;
	let urls: URL[];
	let body: unknown;

	beforeEach(() => {
		saved = {};
		for (const k of ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
		process.env.SECONDLAYER_API_URL = "http://api.test";
		realFetch = globalThis.fetch;
		urls = [];
		body = { runes: [], next_cursor: null };
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			urls.push(new URL(input instanceof Request ? input.url : String(input)));
			return Response.json(body);
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		for (const k of ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
	});

	const run = (...args: string[]) =>
		program().parseAsync(["node", "secondlayer", "index", "runes", ...args]);

	test("the list forwards search, sort, cursor and limit to the catalog", async () => {
		await run(
			"--search",
			"dog",
			"--sort",
			"mints",
			"--cursor",
			"c1",
			"--limit",
			"5",
		);
		expect(urls).toHaveLength(1);
		expect(urls[0]?.pathname).toBe("/v1/index/runes");
		expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
			search: "dog",
			sort: "mints",
			cursor: "c1",
			limit: "5",
		});
	});

	test("get passes a name through untouched, encoded in the path", async () => {
		body = { rune: { id: "840000:3" } };
		await run("get", "DOG•GO•TO•THE•MOON");
		expect(urls[0]?.pathname).toBe(
			`/v1/index/runes/${encodeURIComponent("DOG•GO•TO•THE•MOON")}`,
		);
	});

	test("balances forwards an address with the optional rune narrowing", async () => {
		await run(
			"balances",
			"--address",
			"bc1qaddr",
			"--rune",
			"840000:3",
			"--limit",
			"2",
		);
		expect(urls[0]?.pathname).toBe("/v1/index/runes/balances");
		expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
			address: "bc1qaddr",
			rune: "840000:3",
			limit: "2",
		});
	});

	test("balances forwards an outpoint instead of an address", async () => {
		await run("balances", "--outpoint", "abc:0");
		expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
			outpoint: "abc:0",
		});
	});

	test("activity maps short kinds to rune_* and forwards every filter", async () => {
		body = { events: [], next_cursor: null };
		await run(
			"activity",
			"--rune",
			"840000:3",
			"--address",
			"bc1qaddr",
			"--kind",
			"etch,burn",
			"--txid",
			"deadbeef",
			"--from-height",
			"100",
			"--to-height",
			"200",
			"--cursor",
			"c1",
			"--limit",
			"7",
		);
		expect(urls[0]?.pathname).toBe("/v1/index/runes/activity");
		const q = urls[0]?.searchParams;
		expect(q?.get("kind")).toBe("rune_etch,rune_burn");
		expect(q?.get("rune")).toBe("840000:3");
		expect(q?.get("address")).toBe("bc1qaddr");
		expect(q?.get("txid")).toBe("deadbeef");
		expect(q?.get("from_height")).toBe("100");
		expect(q?.get("to_height")).toBe("200");
		expect(q?.get("limit")).toBe("7");
	});

	test("a rejected flag exits 1 with the reason and sends no request", async () => {
		const exit = spyOn(process, "exit").mockImplementation((() => {
			throw new Error("exit");
		}) as never);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const write = spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			await expect(run("--sort", "newest")).rejects.toThrow("exit");
			await expect(run("balances")).rejects.toThrow("exit");
			expect(exit).toHaveBeenCalledWith(1);
			expect(urls).toHaveLength(0);
		} finally {
			exit.mockRestore();
			err.mockRestore();
			write.mockRestore();
		}
	});
});

describe("rune flag parsing", () => {
	test("--kind maps short names and refuses unknown ones, listing the valid four", () => {
		expect(parseRuneKinds("etch,burn")).toEqual(["rune_etch", "rune_burn"]);
		expect(parseRuneKinds(undefined)).toBeUndefined();
		expect(() => parseRuneKinds("etch,swap")).toThrow(
			/invalid --kind "swap".*etch, mint, transfer, burn/,
		);
	});

	test("--sort accepts number and mints only", () => {
		expect(parseRuneSort("number")).toBe("number");
		expect(parseRuneSort("mints")).toBe("mints");
		expect(() => parseRuneSort("newest")).toThrow(/invalid --sort "newest"/);
	});

	test("balances need exactly one of address or outpoint", () => {
		expect(runeBalanceSubject({ address: "a" })).toEqual({ address: "a" });
		expect(runeBalanceSubject({ outpoint: "t:0" })).toEqual({
			outpoint: "t:0",
		});
		const msg = "pass --address or --outpoint (one of them)";
		expect(() => runeBalanceSubject({})).toThrow(msg);
		expect(() => runeBalanceSubject({ address: "a", outpoint: "t:0" })).toThrow(
			msg,
		);
	});
});
