import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DECODER_VERSION,
	filterHashOf,
	loadCassette,
} from "../src/commands/subgraph-test.ts";

/**
 * A cassette exists so `sl subgraphs test --offline` is free and repeatable.
 * That is only safe if it invalidates when it no longer describes what the
 * subgraph would fetch — a cassette that passes against events the subgraph
 * would no longer request is worse than having none, because it reports
 * confidence it has not earned. That invalidation had no test.
 */
const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cassette-"));
	dirs.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function writeCassette(
	dir: string,
	name: string,
	body: Record<string, unknown>,
): void {
	writeFileSync(join(dir, `${name}.json`), JSON.stringify(body));
}

describe("cassette filter hash", () => {
	test("is stable across source key order", () => {
		const a = filterHashOf({
			swaps: { type: "print_event", topic: "swap" },
			mints: { type: "ft_mint" },
		});
		const b = filterHashOf({
			mints: { type: "ft_mint" },
			swaps: { type: "print_event", topic: "swap" },
		});
		// A cosmetic reshuffle must not throw away a valid recording.
		expect(a).toBe(b);
	});

	test("changes when a filter changes", () => {
		const before = filterHashOf({
			swaps: { type: "print_event", topic: "swap" },
		});
		const after = filterHashOf({
			swaps: { type: "print_event", topic: "burn" },
		});
		expect(after).not.toBe(before);
	});

	test("changes when a source is added", () => {
		const one = filterHashOf({ swaps: { type: "ft_transfer" } });
		const two = filterHashOf({
			swaps: { type: "ft_transfer" },
			mints: { type: "ft_mint" },
		});
		expect(two).not.toBe(one);
	});

	test("survives bigint fields", () => {
		// `minAmount` is a bigint in the source vocabulary; JSON.stringify throws
		// on it without the replacer.
		expect(() =>
			filterHashOf({ big: { type: "ft_transfer", minAmount: 10n } }),
		).not.toThrow();
		expect(
			filterHashOf({ big: { type: "ft_transfer", minAmount: 10n } }),
		).not.toBe(filterHashOf({ big: { type: "ft_transfer", minAmount: 11n } }));
	});
});

describe("cassette loading", () => {
	const sources = { swaps: { type: "print_event", topic: "swap" } };
	const hash = filterHashOf(sources);

	function base(overrides: Record<string, unknown> = {}) {
		return {
			decoderVersion: DECODER_VERSION,
			filterHash: hash,
			subgraph: "demo",
			fromHeight: 1,
			toHeight: 2,
			recordedAt: "2026-07-30T00:00:00.000Z",
			events: { swaps: [] },
			...overrides,
		};
	}

	test("absent cassette is null, not stale", () => {
		expect(loadCassette("nope", hash, tempDir())).toBeNull();
	});

	test("a matching cassette loads", () => {
		const dir = tempDir();
		writeCassette(dir, "demo", base());
		const loaded = loadCassette("demo", hash, dir);
		expect(loaded).not.toBeNull();
		expect((loaded as { stale?: string }).stale).toBeUndefined();
		expect((loaded as { subgraph: string }).subgraph).toBe("demo");
	});

	test("a changed source filter invalidates it", () => {
		const dir = tempDir();
		writeCassette(dir, "demo", base());

		// The critical check: the subgraph now asks for something else, so the
		// recording cannot vouch for it.
		const changed = filterHashOf({
			swaps: { type: "print_event", topic: "burn" },
		});
		expect(loadCassette("demo", changed, dir)).toEqual({
			stale: "sources changed since it was recorded",
		});
	});

	test("a decoder version bump invalidates it", () => {
		const dir = tempDir();
		writeCassette(dir, "demo", base({ decoderVersion: DECODER_VERSION - 1 }));
		expect(loadCassette("demo", hash, dir)).toEqual({
			stale: `recorded by decoder v${DECODER_VERSION - 1}`,
		});
	});

	test("a corrupt cassette is stale, not a crash", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "demo.json"), "{not json");
		expect(loadCassette("demo", hash, dir)).toEqual({ stale: "unreadable" });
	});
});
