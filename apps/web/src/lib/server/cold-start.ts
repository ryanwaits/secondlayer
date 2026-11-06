// Server-only: reads process.uptime and the warm-up timings.

/**
 * One log line per cold instance, so the cost of a first request after idle
 * can be split into process/bundle init, highlighter warm-up, the API
 * connection and the request's own reads. Carries no ids, tokens or account
 * data. Kept on `globalThis` because the startup hook and each route are
 * bundled separately and must share one state.
 */
type ColdStartState = {
	logged: boolean;
	highlighterMs?: number;
	agentConnectMs?: number;
};

const STATE_KEY = Symbol.for("secondlayer.coldStart");
const shared = globalThis as unknown as { [STATE_KEY]?: ColdStartState };
shared[STATE_KEY] ??= { logged: false };
const state = shared[STATE_KEY];

/** Records how long a warm-up step took, measured from when it started. */
export function recordWarmup(
	step: "highlighterMs" | "agentConnectMs",
	startedAt: number,
): void {
	state[step] = Math.round(performance.now() - startedAt);
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
