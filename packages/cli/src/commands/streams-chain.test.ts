import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { parseChain, parseTypes, registerStreamsCommand } from "./streams.ts";

/**
 * `--chain bitcoin` reaches the wire on every Streams read that has a chain,
 * and a command without the flag sends nothing extra (Stacks stays the
 * default).
 */

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
	registerStreamsCommand(p);
	return p;
}

const page = {
	events: [],
	next_cursor: "1:0",
	tip: { block_height: 1 },
	reorgs: [],
};

describe("streams --chain", () => {
	let saved: Record<string, string | undefined>;
	let realFetch: typeof fetch;
	let urls: URL[];

	beforeEach(() => {
		saved = {};
		for (const k of ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
		process.env.SECONDLAYER_API_URL = "http://api.test";
		process.env.INSTANCE_TOKEN = "x";
		realFetch = globalThis.fetch;
		urls = [];
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			urls.push(new URL(input instanceof Request ? input.url : String(input)));
			return Response.json(page);
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
		program().parseAsync(["node", "secondlayer", "streams", ...args]);

	const chains = () => urls.map((u) => u.searchParams.get("chain"));

	test("events, by-tx, consume and reorgs each forward chain=bitcoin", async () => {
		await run("events", "--chain", "bitcoin", "--types", "rune_mint,rune_burn");
		await run("events", "by-tx", "abc", "--chain", "bitcoin");
		await run("consume", "--chain", "bitcoin", "--max-pages", "1");
		await run("reorgs", "--since", "1:0", "--chain", "bitcoin");
		expect(urls.length).toBeGreaterThanOrEqual(4);
		expect(chains().every((c) => c === "bitcoin")).toBe(true);
		expect(urls[0]?.searchParams.get("types")).toBe("rune_mint,rune_burn");
		expect(urls[1]?.pathname).toBe("/v1/streams/events/abc");
	});

	test("without the flag no chain param is sent, so Stacks stays the default", async () => {
		await run("events", "--types", "print");
		await run("events", "by-tx", "abc");
		await run("consume", "--max-pages", "1");
		await run("reorgs", "--since", "1:0");
		expect(urls.length).toBeGreaterThanOrEqual(4);
		expect(chains().every((c) => c === null)).toBe(true);
	});

	test("a bad chain, a Stacks type on bitcoin, or a Stacks-only filter exits 1 before any request", async () => {
		const exit = spyOn(process, "exit").mockImplementation((() => {
			throw new Error("exit");
		}) as never);
		const write = spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			await expect(run("events", "--chain", "solana")).rejects.toThrow("exit");
			await expect(
				run("events", "--chain", "bitcoin", "--types", "print"),
			).rejects.toThrow("exit");
			await expect(
				run("events", "--chain", "bitcoin", "--sender", "SP1"),
			).rejects.toThrow("exit");
			expect(urls).toHaveLength(0);
		} finally {
			exit.mockRestore();
			write.mockRestore();
		}
	});
});

describe("chain parsing", () => {
	test("--chain accepts stacks or bitcoin only; stacks forwards nothing", () => {
		expect(parseChain(undefined)).toBeUndefined();
		expect(parseChain("stacks")).toBeUndefined();
		expect(parseChain("bitcoin")).toBe("bitcoin");
		expect(() => parseChain("solana")).toThrow(/invalid --chain "solana"/);
	});

	test("types are checked against the chain's own vocabulary", () => {
		expect(parseTypes("print")).toEqual(["print"]);
		expect(parseTypes("rune_etch", "--types", "bitcoin")).toEqual([
			"rune_etch",
		]);
		expect(() => parseTypes("rune_etch")).toThrow(/invalid --types/);
		expect(() => parseTypes("print", "--types", "bitcoin")).toThrow(
			/rune_etch, rune_mint, rune_transfer, rune_burn/,
		);
	});
});
