import { describe, expect, test } from "bun:test";
import type { ChainTrigger } from "@secondlayer/shared/schemas/webhooks";
import { parseRuneRef } from "../bitcoin/db.ts";
import {
	type RuneEntryLookupDb,
	normalizeRuneTriggers,
	resolveRuneId,
} from "./webhooks.ts";

/** A stub satisfying just the lookup shape `resolveRuneId` needs — no scratch
 *  Bitcoin/Runes database required for this normalization-layer unit test
 *  (see `../index/runes.test.ts`'s doc comment for the heavier DB-backed tier). */
function stubDb(entries: Record<string, string>): RuneEntryLookupDb {
	return {
		selectFrom: () => ({
			select: () => ({
				where: (_col: "rune", _op: "=", value: string) => ({
					executeTakeFirst: async () => {
						const rune_id = entries[value];
						return rune_id ? { rune_id } : undefined;
					},
				}),
			}),
		}),
	};
}

describe("resolveRuneId", () => {
	test("an id-form ref resolves to itself, no DB lookup", async () => {
		const ref = parseRuneRef("840000:3");
		const db = stubDb({}); // empty — would fail if this hit the lookup
		expect(await resolveRuneId(ref, db)).toBe("840000:3");
	});

	test("a name-form ref resolves via the base-26 `rune` integer lookup", async () => {
		const ref = parseRuneRef("DOG•GO•TO•THE•MOON");
		expect("rune" in ref).toBe(true);
		const runeInt = (ref as { rune: bigint }).rune.toString();
		const db = stubDb({ [runeInt]: "840000:3" });
		expect(await resolveRuneId(ref, db)).toBe("840000:3");
	});

	test("an unknown name-form ref resolves to undefined", async () => {
		const ref = parseRuneRef("NOSUCHRUNE");
		const db = stubDb({});
		expect(await resolveRuneId(ref, db)).toBeUndefined();
	});
});

describe("normalizeRuneTriggers — no live Bitcoin data (unconfigured, or configured with no DB handle)", () => {
	// An id-form ref IS the canonical key — no lookup needed, so it's always
	// safe to accept and normalize even with nothing to resolve a name against.
	test("not configured: an id-form rune is accepted and normalized", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_burn", rune: "0840000:03" }, // leading zeros
		];
		const result = await normalizeRuneTriggers(triggers, { configured: false });
		expect(result).toEqual([{ type: "rune_burn", rune: "840000:3" }]);
	});

	test("configured but the DB handle is unavailable: an id-form rune is accepted and normalized", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_etch", rune: "0840000:03" },
		];
		const result = await normalizeRuneTriggers(triggers, {
			configured: true,
			db: undefined,
		});
		expect(result).toEqual([{ type: "rune_etch", rune: "840000:3" }]);
	});

	// A name-form ref needs a lookup this instance can't perform. Storing it
	// raw would silently never match once Runes data does land — the
	// evaluator compares against `rune_id`, not a name — so reject up front
	// instead of degrading to a no-op.
	test("not configured: a name-form rune is rejected, not silently stored raw", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_transfer", rune: "DOG•GO•TO•THE•MOON" },
		];
		await expect(
			normalizeRuneTriggers(triggers, { configured: false }),
		).rejects.toThrow(
			'rune names need Runes data on this instance; use the rune id instead (e.g. "840000:3")',
		);
	});

	test("configured but the DB handle is unavailable: a name-form rune is rejected", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_mint", rune: "dog.go.to.the.moon" },
		];
		await expect(
			normalizeRuneTriggers(triggers, { configured: true, db: undefined }),
		).rejects.toThrow(/rune names need Runes data on this instance/);
	});

	test("leaves a Stacks trigger untouched when not configured", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "ft_transfer", trait: "sip-010" },
		];
		const result = await normalizeRuneTriggers(triggers, { configured: false });
		expect(result).toEqual(triggers);
	});

	test("leaves a rune trigger with no `rune` field untouched when not configured", async () => {
		const triggers: ChainTrigger[] = [{ type: "rune_etch" }];
		const result = await normalizeRuneTriggers(triggers, { configured: false });
		expect(result).toEqual(triggers);
	});
});

describe("normalizeRuneTriggers", () => {
	test("leaves a Stacks trigger untouched even when configured", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "ft_transfer", trait: "sip-010" },
		];
		const result = await normalizeRuneTriggers(triggers, {
			configured: true,
			db: stubDb({}),
		});
		expect(result).toEqual(triggers);
	});

	test("leaves a rune trigger with no `rune` field untouched", async () => {
		const triggers: ChainTrigger[] = [{ type: "rune_etch" }];
		const result = await normalizeRuneTriggers(triggers, {
			configured: true,
			db: stubDb({}),
		});
		expect(result).toEqual(triggers);
	});

	test("normalizes an id-form rune to itself", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_burn", rune: "0840000:03" }, // leading zeros
		];
		const result = await normalizeRuneTriggers(triggers, {
			configured: true,
			db: stubDb({}),
		});
		expect(result).toEqual([{ type: "rune_burn", rune: "840000:3" }]);
	});

	test("normalizes a name-form rune to its canonical id via the DB lookup", async () => {
		const ref = parseRuneRef("DOG•GO•TO•THE•MOON");
		const runeInt = (ref as { rune: bigint }).rune.toString();
		const triggers: ChainTrigger[] = [
			{ type: "rune_mint", rune: "dog.go.to.the.moon" },
		];
		const result = await normalizeRuneTriggers(triggers, {
			configured: true,
			db: stubDb({ [runeInt]: "840000:3" }),
		});
		expect(result).toEqual([{ type: "rune_mint", rune: "840000:3" }]);
	});

	test("rejects an unknown rune with ValidationError", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_transfer", rune: "NOSUCHRUNE" },
		];
		await expect(
			normalizeRuneTriggers(triggers, { configured: true, db: stubDb({}) }),
		).rejects.toThrow(/unknown rune/);
	});

	test("rejects an unparseable rune reference", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "rune_transfer", rune: "  " }, // blank after trim
		];
		await expect(
			normalizeRuneTriggers(triggers, { configured: true, db: stubDb({}) }),
		).rejects.toThrow(/invalid rune reference/);
	});
});
