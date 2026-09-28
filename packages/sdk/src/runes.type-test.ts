/**
 * Type-level tests for `index.runes`. Checked by `tsc` (src is included),
 * never bundled nor run.
 *
 * The one shape worth locking down at the type level: `balances` requires
 * exactly one of `address`/`outpoint` — a union, not a runtime check, so
 * passing both or neither must be a compile error.
 */
import { expectTypeOf } from "expect-type";
import type {
	Index,
	IndexRuneEntry,
	IndexRuneEvent,
	RuneEnvelope,
	RuneId,
	RuneRef,
} from "./index-api/client.ts";

declare const idx: Index;

async function balancesRequiresExactlyOneOfAddressOrOutpoint() {
	await idx.runes.balances({
		address: "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg",
	});
	await idx.runes.balances({ outpoint: "abcd:1" });

	// @ts-expect-error — neither address nor outpoint
	await idx.runes.balances({});
	// @ts-expect-error — both address and outpoint
	await idx.runes.balances({
		address: "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg",
		outpoint: "abcd:1",
	});
}

// `RuneRef` accepts an id, a spaced name, or a bare name — any string —
// while `RuneId` is the narrower `<block>:<tx>` template literal.
function runeRefAcceptsIdOrAnyNameForm() {
	const byId: RuneRef = "840000:3";
	const bySpacedName: RuneRef = "DOG•GO•TO•THE•MOON";
	const byBareName: RuneRef = "doggotothemoon";
	expectTypeOf(byId).toMatchTypeOf<RuneRef>();
	expectTypeOf(bySpacedName).toMatchTypeOf<RuneRef>();
	expectTypeOf(byBareName).toMatchTypeOf<RuneRef>();

	const id: RuneId = "840000:3";
	expectTypeOf(id).toMatchTypeOf<RuneRef>();
}

// `get` resolves `null` on 404 — the same "absent resource" rule as every
// other Index point-get (`requestOrNull`).
async function getResolvesNullOn404() {
	const res = await idx.runes.get("840000:3");
	expectTypeOf(res).toEqualTypeOf<RuneEnvelope | null>();
	if (res) expectTypeOf(res.rune).toEqualTypeOf<IndexRuneEntry>();
}

async function activityWalkYieldsRuneEvents() {
	for await (const event of idx.runes.activity.walk({ fromHeight: 900_000 })) {
		expectTypeOf(event).toEqualTypeOf<IndexRuneEvent>();
	}
}

export type {
	balancesRequiresExactlyOneOfAddressOrOutpoint,
	runeRefAcceptsIdOrAnyNameForm,
	getResolvesNullOn404,
	activityWalkYieldsRuneEvents,
};
