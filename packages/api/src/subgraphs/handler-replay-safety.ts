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

const METHODS = DELTA_CTX_METHODS.join("|");

/**
 * Detection patterns for a delta-applying write. This is a heuristic, not a
 * parser — it errs toward flagging (a false positive only marks a deploy
 * non-replay-safe, the safe default). It deliberately catches the common ways a
 * plain `ctx.method(` regex was dodged:
 *
 * 1. `ctx.update(` / `ctx?.update` / `const u = ctx.update` — any member access
 *    of a delta method, called OR aliased (the old `\s*\(` form missed the
 *    alias-the-reference defeat `const u = ctx.update; u(...)`).
 * 2. `ctx["update"]` — bracket access with a string key.
 * 3. `const { update } = ctx` — destructuring a delta method off `ctx`.
 *
 * Known residual gap (needs a real AST / data-flow pass — see ROADMAP): aliasing
 * the context object itself (`const c = ctx; c.update(...)`) or a computed key
 * (`ctx[name]`). Those require scope tracking a regex can't do safely.
 */
const PATTERNS: RegExp[] = [
	// Member access (dot or optional-chain), called or referenced.
	new RegExp(`\\bctx\\s*\\??\\.\\s*(?:${METHODS})\\b`),
	// Bracket access with a quoted key: ctx["update"] / ctx['increment'].
	new RegExp(`\\bctx\\s*\\[\\s*(['"\`])(?:${METHODS})\\1\\s*\\]`),
	// Destructuring off ctx: const { update, ... } = ctx.
	new RegExp(`\\{[^{}]*\\b(?:${METHODS})\\b[^{}]*\\}\\s*=\\s*ctx\\b`),
];

/**
 * Back-compat export: the original member-call pattern. Prefer
 * {@link hasNonReplayableWrites}, which applies the full pattern set.
 */
export const NON_REPLAYABLE_HANDLER_RE = new RegExp(
	`\\bctx\\.(${METHODS})\\s*\\(`,
);

/** True when handler/source code applies non-replayable deltas. */
export function hasNonReplayableWrites(
	handlerCode: string | null | undefined,
	sourceCode?: string | null,
): boolean {
	const code = `${sourceCode ?? ""}\n${handlerCode ?? ""}`;
	return PATTERNS.some((re) => re.test(code));
}
