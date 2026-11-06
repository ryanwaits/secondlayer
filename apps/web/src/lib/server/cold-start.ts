// Server-only: reads process.uptime and the warm-up timings.

/**
 * One log line per cold instance, so the cost of a first request after idle
 * can be split into process/bundle init, highlighter warm-up, the API
 * connection and the request's own reads. Carries no ids, tokens or account
 * data. Kept on `globalThis` because the startup hook and each route are
 * bundled separately and must share one state.
 */
type WarmupStep = "highlighterMs" | "agentConnectMs";
type WarmupResult = number | `failed:${string}`;

type ColdStartState = {
	logged: boolean;
	highlighterStarted: boolean;
} & { [step in WarmupStep]?: WarmupResult };

const STATE_KEY = Symbol.for("secondlayer.coldStart");
const shared = globalThis as unknown as { [STATE_KEY]?: ColdStartState };
shared[STATE_KEY] ??= { logged: false, highlighterStarted: false };
const state = shared[STATE_KEY];

/** Stores a step's result; one that lands after the cold-start line went out
 *  (the highlighter warms after the first response) gets its own line. */
function record(step: WarmupStep, result: WarmupResult): void {
	state[step] = result;
	if (state.logged) console.log(`cold-start late ${step}=${result}`);
}

/** Records how long a warm-up step took, measured from when it started. */
export function recordWarmup(step: WarmupStep, startedAt: number): void {
	record(step, Math.round(performance.now() - startedAt));
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,40}$/;

/** The error's code (own or its cause's) or name, never its message, which
 *  could hold a URL. */
function errorCode(err: unknown): string {
	for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
		const code = (e as { code?: unknown } | null)?.code;
		if (typeof code === "string" && SAFE_CODE.test(code)) return code;
	}
	const name = (err as { name?: unknown } | null)?.name;
	return typeof name === "string" && SAFE_CODE.test(name) ? name : "unknown";
}

/** Records that a warm-up step failed, so a failure reads differently from
 *  one still pending. */
export function recordWarmupFailure(step: WarmupStep, err: unknown): void {
	record(step, `failed:${errorCode(err)}`);
}

/** True for the first caller only: the highlighter warms once per instance. */
export function claimHighlighterWarmup(): boolean {
	if (state.highlighterStarted) return false;
	state.highlighterStarted = true;
	return true;
}

/** The cold-start line for the first request an instance serves; later calls
 *  return null. `requestStartedAt` is `performance.now()` when the request began. */
export function coldStartLine(
	route: string,
	requestStartedAt: number,
): string | null {
	if (state.logged) return null;
	state.logged = true;
	const firstRequestMs = Math.round(performance.now() - requestStartedAt);
	const initMs = Math.round(process.uptime() * 1000) - firstRequestMs;
	// A warm-up still running when the first request finishes reads "pending".
	return `cold-start route=${route} initMs=${initMs} firstRequestMs=${firstRequestMs} highlighterMs=${state.highlighterMs ?? "pending"} agentConnectMs=${state.agentConnectMs ?? "pending"}`;
}

/** Logs the cold-start line once per instance. */
export function logColdStart(route: string, requestStartedAt: number): void {
	const line = coldStartLine(route, requestStartedAt);
	if (line) console.log(line);
}
