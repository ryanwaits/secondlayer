/**
 * Delta-applying SubgraphContext methods — writes that DOUBLE-APPLY when a
 * block is replayed (at-least-once paths: BYO phase-A, backfill walks that
 * revisit processed heights, crash-resume overshoot). Insert/upsert with a
 * unique key are replay-safe; these are not.
 *
 * Single source for every guard (BYO deploy, backfill route, tip-first
 * deploy) — the drift test enumerates SubgraphContext to keep this honest.
 */
export const DELTA_CTX_METHODS = [
	"update",
	"patchOrInsert",
	"increment",
] as const;

export const NON_REPLAYABLE_HANDLER_RE = new RegExp(
	`\\bctx\\.(${DELTA_CTX_METHODS.join("|")})\\s*\\(`,
);

/** True when handler/source code applies non-replayable deltas. */
export function hasNonReplayableWrites(
	handlerCode: string | null | undefined,
	sourceCode?: string | null,
): boolean {
	return NON_REPLAYABLE_HANDLER_RE.test(
		`${sourceCode ?? ""}\n${handlerCode ?? ""}`,
	);
}
