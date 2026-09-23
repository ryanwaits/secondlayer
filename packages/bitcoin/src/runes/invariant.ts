// Supply invariant — not a port of any single ord file (ord doesn't run this
// check itself; it's our own correctness gate on top of the ported state
// machine, per plan design). For every rune: the amount in circulation plus
// what's been burned must equal what's ever been created (premine + minted
// amount so far). Runs over the dirty-rune set at every flush; a violation
// means the updater diverged from ord's rules and must fail closed.

import { runeEntrySupply } from "./entry.ts";
import { type RuneState, sumRuneBalance } from "./state.ts";

export class InvariantViolationError extends Error {
	constructor(
		readonly runeId: string,
		readonly expected: bigint,
		readonly actual: bigint,
	) {
		super(
			`rune ${runeId} supply invariant violated: sum(balances)+burned=${actual} != premine+mints*amount=${expected}`,
		);
		this.name = "InvariantViolationError";
	}
}

/**
 * Checks `sum(balances) + burned == premine + mints * (terms.amount ?? 0)`
 * for every rune in `runeIds`. Throws `InvariantViolationError` on the first
 * mismatch (fail closed, per plan design) — callers should treat this as a
 * decoder bug, not a data condition to recover from.
 */
export function checkInvariant(
	state: RuneState,
	runeIds: Iterable<string>,
): void {
	for (const runeId of runeIds) {
		const entry = state.entries.get(runeId);
		if (!entry) {
			// A rune with dirty balance/entry activity must have an entry by the
			// time a flush runs; a missing entry is itself a bug, not a valid state.
			throw new InvariantViolationError(runeId, 0n, 0n);
		}

		const expected = runeEntrySupply(entry);
		const actual = sumRuneBalance(state, runeId) + entry.burned;

		if (actual !== expected) {
			throw new InvariantViolationError(runeId, expected, actual);
		}
	}
}
