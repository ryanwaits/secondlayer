import { describe, expect, test } from "bun:test";
import type { ApiKey } from "@/lib/types";
import {
	dayLabels,
	groupKeys,
	hasStaleOwnKey,
	keyFlags,
	keyForLabel,
	keysSentence,
	overviewKeys,
	sumDaily,
} from "./key-view";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (n: number) =>
	new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sl_abc",
	name: "a key",
	status: "active",
	product: "account",
	tier: null,
	createdAt: daysAgo(100),
	lastUsedAt: null,
	...patch,
});

describe("keyFlags", () => {
	test("a never-used key made 31 days ago is stale", () => {
		expect(keyFlags(key({ createdAt: daysAgo(31) }), NOW)).toEqual({
			staleDays: 31,
		});
	});

	test("a key used yesterday is not stale", () => {
		expect(keyFlags(key({ lastUsedAt: daysAgo(1) }), NOW)).toEqual({});
	});

	test("staleness counts from the last use, not creation", () => {
		expect(
			keyFlags(key({ createdAt: daysAgo(200), lastUsedAt: daysAgo(40) }), NOW),
		).toEqual({ staleDays: 40 });
	});

	test("a docs key 4 hours from expiry says so and is never stale", () => {
		const expiresAt = new Date(NOW.getTime() + 4 * 3_600_000).toISOString();
		expect(
			keyFlags(
				key({ product: "docs", expiresAt, createdAt: daysAgo(90) }),
				NOW,
			),
		).toEqual({ expiresInHours: 4 });
	});

	test("a key made for you is never flagged", () => {
		expect(
			keyFlags(key({ product: "tenant", createdAt: daysAgo(90) }), NOW),
		).toEqual({});
	});
});

describe("keyForLabel", () => {
	test("names what each key is for", () => {
		expect(keyForLabel("account")).toBe("Your key");
		expect(keyForLabel("streams")).toBe("Your key");
		expect(keyForLabel("index")).toBe("Your key");
		expect(keyForLabel("docs")).toBe("Docs samples");
		expect(keyForLabel("tenant")).toBe("Your hosted stack");
		expect(keyForLabel("sentinel")).toBe("Sentinel");
	});
});

describe("groupKeys", () => {
	test("splits own keys from the ones made for you and hides revoked or expired", () => {
		const live = new Date(NOW.getTime() + 3_600_000).toISOString();
		const dead = new Date(NOW.getTime() - 3_600_000).toISOString();
		const { own, madeForYou } = groupKeys(
			[
				key({ id: "a" }),
				key({ id: "d", product: "docs", expiresAt: live }),
				key({ id: "x", product: "docs", expiresAt: dead }),
				key({ id: "r", status: "revoked" }),
				key({ id: "t", product: "tenant" }),
				key({ id: "s", product: "sentinel" }),
			],
			NOW,
		);
		expect(own.map((k) => k.id)).toEqual(["a", "d"]);
		expect(madeForYou.map((k) => k.id)).toEqual(["t", "s"]);
	});
});

describe("keysSentence", () => {
	const used = (patch: Partial<ApiKey>) =>
		key({ lastUsedAt: daysAgo(1), ...patch });

	test("no keys, one key and several keys in use", () => {
		expect(keysSentence([], NOW).text).toBe("No keys yet.");
		expect(keysSentence([used({})], NOW).text).toBe("Your key is in use.");
		expect(keysSentence([used({ id: "a" }), used({ id: "b" })], NOW)).toEqual({
			tone: "ok",
			text: "All 2 keys in use.",
		});
	});

	test("two stale keys are named together with the shortest idle time", () => {
		const out = keysSentence(
			[
				used({ id: "a" }),
				used({ id: "b", name: "ci", lastUsedAt: daysAgo(45) }),
				used({ id: "c", name: "old", lastUsedAt: daysAgo(35) }),
			],
			NOW,
		);
		expect(out.text).toBe("1 key in use.");
		expect(out.sub).toBe("ci and old haven't read anything in 35 days");
	});

	test("the first-run copy never mentions agents", () => {
		const out = keysSentence([], NOW);
		expect(out.tone).toBe("idle");
		expect(out.sub).not.toContain("agents");
	});

	test("every key revoked counts them and says webhooks keep running", () => {
		const gone = (id: string) => key({ id, status: "revoked" });
		const two = keysSentence([gone("a"), gone("b")], NOW);
		expect(two.tone).toBe("idle");
		expect(two.text).toBe("No active keys.");
		expect(two.sub).toContain("You revoked all 2.");
		expect(keysSentence([gone("a")], NOW).sub).toContain(
			"You revoked your only key.",
		);
	});

	test("a revoked key still being called turns the header to an alarm", () => {
		const out = keysSentence([key({ status: "revoked" })], NOW, {
			revokedInUse: true,
		});
		expect(out.tone).toBe("alarm");
		expect(out.text).toBe("No active keys, and one is still called.");
	});

	test("a docs key is not counted", () => {
		const docs = used({ id: "d", product: "docs" });
		expect(keysSentence([docs], NOW).text).toBe("No keys yet.");
	});
});

describe("overviewKeys", () => {
	test("hidden when the account has no keys of its own", () => {
		expect(overviewKeys([], NOW)).toBeNull();
		expect(overviewKeys([key({ product: "tenant" })], NOW)).toBeNull();
	});

	test("names the newest read and sums the daily rows", () => {
		const out = overviewKeys(
			[
				key({
					id: "a",
					name: "laptop",
					lastUsedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
					rowsDaily: new Array(30).fill(1),
				}),
				key({
					id: "b",
					name: "ci",
					lastUsedAt: daysAgo(2),
					rowsDaily: new Array(30).fill(2),
				}),
			],
			NOW,
		);
		expect(out?.state).toBe("2 keys · laptop read 3h ago");
		expect(out?.tone).toBe("ok");
		expect(out?.count).toBe("2");
		expect(out?.age).toBe("3h");
		expect(out?.spark).toEqual(new Array(24).fill(3));
	});

	test("a stale key adds its name and turns the dot yellow", () => {
		const out = overviewKeys(
			[
				key({ id: "a", name: "laptop", lastUsedAt: daysAgo(1) }),
				key({ id: "b", name: "old-indexer", lastUsedAt: daysAgo(40) }),
			],
			NOW,
		);
		expect(out?.tone).toBe("hi");
		expect(out?.state).toBe(
			"2 keys · laptop read 1d ago · old-indexer unused 40 days",
		);
	});

	test("keys never read say so, and an old API leaves the sparkline out", () => {
		const out = overviewKeys(
			[key({ createdAt: daysAgo(2), lastUsedAt: null })],
			NOW,
		);
		expect(out?.state).toBe("1 key · none read yet");
		expect(out?.spark).toBeNull();
		expect(out?.age).toBe("–");
	});
});

describe("sumDaily and dayLabels", () => {
	test("sums per day and keeps the last points", () => {
		expect(
			sumDaily(
				[key({ rowsDaily: [1, 2, 3] }), key({ rowsDaily: [10, 20, 30] })],
				2,
			),
		).toEqual([22, 33]);
	});

	test("one label per day, ending today", () => {
		const labels = dayLabels(NOW);
		expect(labels).toHaveLength(30);
		expect(labels.at(-1)).toBe("Oct 15");
		expect(labels[0]).toBe("Sep 16");
	});
});

describe("hasStaleOwnKey", () => {
	test("a key unused 40 days keeps the unused-key note", () => {
		expect(hasStaleOwnKey([key({ lastUsedAt: daysAgo(40) })], NOW)).toBe(true);
	});

	test("once that key is revoked and gone from the list, the note hides", () => {
		expect(hasStaleOwnKey([key({ lastUsedAt: daysAgo(1) })], NOW)).toBe(false);
		expect(hasStaleOwnKey([], NOW)).toBe(false);
	});

	test("an idle key made for you never counts", () => {
		expect(
			hasStaleOwnKey(
				[key({ product: "sentinel", lastUsedAt: daysAgo(90) })],
				NOW,
			),
		).toBe(false);
	});
});
