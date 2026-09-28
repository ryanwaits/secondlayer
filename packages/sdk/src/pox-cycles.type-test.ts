/**
 * Type-level test for `index.pox.cycles` (plan 078 — SDK major). Checked by
 * `tsc` (src is included), never bundled nor run.
 *
 * `pox/cycles` now reports the CURRENT PoX (PoX-5): `pox_version` is a
 * required field, `IndexPoxCycle` is the v5 shape, and the v4-only fields
 * (`unique_stackers`, `unique_delegators`, `action_count`,
 * `function_breakdown`) no longer exist anywhere on it.
 */
import { expectTypeOf } from "expect-type";
import type { Index, IndexPoxCycle, IndexPoxCycleSigner } from "./index.ts";

declare const sl: { index: Index };

async function listReportsPoxVersionAndTheV5Shape() {
	const page = await sl.index.pox.cycles.list({ limit: 10 });
	expectTypeOf(page.pox_version).toEqualTypeOf<5>();
	// @ts-expect-error — the v4 envelope's `notes` field is gone
	page.notes;

	const cycle: IndexPoxCycle | undefined = page.cycles[0];
	if (!cycle) return;
	cycle.is_current;
	cycle.is_frozen;
	cycle.reward_eligible_ustx;
	cycle.bond_sats;
	cycle.rewards_per_token_stx;
	// @ts-expect-error — retired with the pox-4 rollup
	cycle.unique_stackers;
	// @ts-expect-error — retired with the pox-4 rollup
	cycle.unique_delegators;
	// @ts-expect-error — retired with the pox-4 rollup
	cycle.action_count;
	// @ts-expect-error — retired with the pox-4 rollup
	cycle.function_breakdown;
}
void listReportsPoxVersionAndTheV5Shape;

async function getCarriesPerCycleSigners() {
	const res = await sl.index.pox.cycles.get(141);
	if (!res) return;
	expectTypeOf(res.pox_version).toEqualTypeOf<5>();
	expectTypeOf(res.cycle.signers).toEqualTypeOf<IndexPoxCycleSigner[]>();
	// @ts-expect-error — the v4 envelope's `notes` field is gone
	res.notes;
}
void getCarriesPerCycleSigners;
