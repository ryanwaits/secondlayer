import { describe, expect, test } from "bun:test";
import {
	STREAMS_CACHE_KEY_EXCLUDED,
	STREAMS_IMMUTABLE_CACHE_CONTROL,
	STREAMS_MUTABLE_CACHE_CONTROL,
	isFinalizedHeight,
	matchesIfNoneMatch,
	streamsETag,
	streamsEventsCacheControl,
	streamsEventsCachePlan,
} from "./cache.ts";
import { type StreamsEventsQuery, parseStreamsEventsQuery } from "./events.ts";
import type { StreamsTip } from "./tip.ts";

const TIP: StreamsTip = {
	block_height: 1000,
	block_hash: "0x01",
	burn_block_height: 2000,
	finalized_height: 900,
	lag_seconds: 0,
};

function params(query: string) {
	return new URL(`http://localhost/v1/streams/events${query}`).searchParams;
}

describe("isFinalizedHeight", () => {
	test("true at or below the boundary, false above or undefined", () => {
		expect(isFinalizedHeight(900, TIP)).toBe(true);
		expect(isFinalizedHeight(899, TIP)).toBe(true);
		expect(isFinalizedHeight(901, TIP)).toBe(false);
		expect(isFinalizedHeight(undefined, TIP)).toBe(false);
	});
});

describe("streamsEventsCacheControl", () => {
	test("immutable for a closed range ending at or below the boundary", () => {
		expect(streamsEventsCacheControl(params("?to_height=900"), TIP)).toBe(
			STREAMS_IMMUTABLE_CACHE_CONTROL,
		);
		expect(
			streamsEventsCacheControl(params("?from_height=0&to_height=500"), TIP),
		).toBe(STREAMS_IMMUTABLE_CACHE_CONTROL);
	});

	test("mutable for a default (tip-spanning) request", () => {
		expect(streamsEventsCacheControl(params(""), TIP)).toBe(
			STREAMS_MUTABLE_CACHE_CONTROL,
		);
	});

	test("mutable when the explicit range crosses the boundary", () => {
		expect(streamsEventsCacheControl(params("?to_height=950"), TIP)).toBe(
			STREAMS_MUTABLE_CACHE_CONTROL,
		);
	});

	test("cache key isolates distinct payload filters", () => {
		const base = streamsEventsCachePlan(params("?to_height=900"), TIP).cacheKey;
		const bySender = streamsEventsCachePlan(
			params("?to_height=900&sender=SP1"),
			TIP,
		).cacheKey;
		const byRecipient = streamsEventsCachePlan(
			params("?to_height=900&recipient=SP1"),
			TIP,
		).cacheKey;
		expect(base).not.toBe(bySender);
		expect(bySender).not.toBe(byRecipient);
	});
});

describe("streamsETag", () => {
	test("stable for identical bodies, distinct for different bodies", () => {
		expect(streamsETag('{"a":1}')).toBe(streamsETag('{"a":1}'));
		expect(streamsETag('{"a":1}')).not.toBe(streamsETag('{"a":2}'));
	});

	test("emits a weak validator", () => {
		expect(streamsETag("{}").startsWith('W/"')).toBe(true);
	});
});

describe("matchesIfNoneMatch", () => {
	const etag = streamsETag('{"a":1}');

	test("matches the same tag and weak/strong variants", () => {
		expect(matchesIfNoneMatch(etag, etag)).toBe(true);
		expect(matchesIfNoneMatch(etag.replace(/^W\//, ""), etag)).toBe(true);
		expect(matchesIfNoneMatch("*", etag)).toBe(true);
		expect(matchesIfNoneMatch(`"other", ${etag}`, etag)).toBe(true);
	});

	test("does not match a different or absent tag", () => {
		expect(matchesIfNoneMatch(streamsETag('{"a":2}'), etag)).toBe(false);
		expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
		expect(matchesIfNoneMatch("", etag)).toBe(false);
	});
});

describe("streamsEventsCachePlan — key coverage", () => {
	function key(qs: string): string | null {
		return streamsEventsCachePlan(new URLSearchParams(qs), TIP).cacheKey;
	}

	test("not_types forks the key", () => {
		const withExclusion = key("from_height=1&to_height=800&not_types=print");
		expect(withExclusion).not.toBeNull();
		expect(withExclusion).not.toBe(key("from_height=1&to_height=800"));
	});

	test("resolved clock forks the key when types is omitted", () => {
		const classic = key("from_height=1&to_height=800");
		const vm = key("from_height=1&to_height=800&clock=vm");
		expect(classic).not.toBeNull();
		expect(vm).not.toBeNull();
		expect(classic).not.toBe(vm);
	});

	test("clock isolation does not depend on request order", () => {
		const classicThenVm = [
			key("from_height=1&to_height=800"),
			key("from_height=1&to_height=800&clock=vm"),
		];
		const vmThenClassic = [
			key("from_height=1&to_height=800&clock=vm"),
			key("from_height=1&to_height=800"),
		];
		expect(classicThenVm[0]).toBe(vmThenClassic[1]);
		expect(classicThenVm[1]).toBe(vmThenClassic[0]);
		expect(classicThenVm[0]).not.toBe(classicThenVm[1]);
	});

	test("a labelled filter map forks the key", () => {
		const filters = encodeURIComponent(
			JSON.stringify({ peg: { types: ["ft_transfer"] } }),
		);
		expect(key(`from_height=1&to_height=800&filters=${filters}`)).not.toBe(
			key("from_height=1&to_height=800"),
		);
	});

	test("labels are part of the key — they ride back on every row", () => {
		const asPeg = encodeURIComponent(
			JSON.stringify({ peg: { types: ["ft_transfer"] } }),
		);
		const asMints = encodeURIComponent(
			JSON.stringify({ mints: { types: ["ft_transfer"] } }),
		);
		expect(key(`from_height=1&to_height=800&filters=${asPeg}`)).not.toBe(
			key(`from_height=1&to_height=800&filters=${asMints}`),
		);
	});

	test("label declaration order does not fork the key", () => {
		const a = encodeURIComponent(
			JSON.stringify({
				peg: { types: ["ft_transfer"] },
				tre: { sender: "SP1" },
			}),
		);
		const b = encodeURIComponent(
			JSON.stringify({
				tre: { sender: "SP1" },
				peg: { types: ["ft_transfer"] },
			}),
		);
		expect(key(`from_height=1&to_height=800&filters=${a}`)).toBe(
			key(`from_height=1&to_height=800&filters=${b}`),
		);
	});
});

describe("streamsEventsCachePlan — every parsed field is decided", () => {
	// A new field on StreamsEventsQuery breaks this Record at compile time and
	// the runtime check below; the author must say whether it forks the key.
	const DECISIONS: Record<keyof StreamsEventsQuery, "keyed" | "excluded"> = {
		clock: "keyed",
		cursor: "excluded",
		cursorRaw: "keyed",
		fromHeight: "keyed",
		toHeight: "keyed",
		types: "keyed",
		notTypes: "keyed",
		contractId: "keyed",
		sender: "keyed",
		recipient: "keyed",
		assetIdentifier: "keyed",
		filters: "keyed",
		limit: "keyed",
		cursorPastTip: "excluded",
	};

	test("the excluded list is exactly the fields decided as excluded", () => {
		const excluded = Object.entries(DECISIONS)
			.filter(([, decision]) => decision === "excluded")
			.map(([name]) => name)
			.sort();
		expect([...STREAMS_CACHE_KEY_EXCLUDED].map(String).sort()).toEqual(
			excluded,
		);
	});

	test("every field a parsed query carries has a decision", () => {
		const parsed = parseStreamsEventsQuery(
			new URLSearchParams(
				"to_height=800&cursor=5:1&types=print&not_types=ft_transfer&contract_id=SP1.a&sender=SP1&recipient=SP2&asset_identifier=SP1.a::x&limit=10",
			),
			TIP,
		);
		for (const name of Object.keys(parsed)) {
			expect(Object.keys(DECISIONS)).toContain(name);
		}
	});

	const BASE = "from_height=1&to_height=800";
	const VARIANTS: Record<string, string> = {
		clock: `${BASE}&clock=vm`,
		cursorRaw: `${BASE.replace("from_height=1&", "")}&cursor=5:1`,
		fromHeight: "from_height=2&to_height=800",
		toHeight: "from_height=1&to_height=700",
		types: `${BASE}&types=print`,
		notTypes: `${BASE}&not_types=print`,
		contractId: `${BASE}&contract_id=SP1.a`,
		sender: `${BASE}&sender=SP1`,
		recipient: `${BASE}&recipient=SP1`,
		assetIdentifier: `${BASE}&asset_identifier=SP1.a::x`,
		filters: `${BASE}&filters=${encodeURIComponent(JSON.stringify({ a: { types: ["print"] } }))}`,
		limit: `${BASE}&limit=7`,
	};

	test("each keyed field forks the key", () => {
		const base = streamsEventsCachePlan(
			new URLSearchParams(BASE),
			TIP,
		).cacheKey;
		for (const [name, decision] of Object.entries(DECISIONS)) {
			if (decision !== "keyed") continue;
			const variant = VARIANTS[name];
			expect(variant).toBeDefined();
			expect(
				streamsEventsCachePlan(new URLSearchParams(variant), TIP).cacheKey,
			).not.toBe(base);
		}
	});

	test("order of set-valued params does not fork the key", () => {
		const key = (qs: string) =>
			streamsEventsCachePlan(new URLSearchParams(qs), TIP).cacheKey;
		expect(key(`${BASE}&types=print,ft_transfer`)).toBe(
			key(`${BASE}&types=ft_transfer,print`),
		);
	});
});
