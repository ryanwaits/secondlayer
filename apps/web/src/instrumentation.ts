/**
 * Runs once when a server instance starts, and the server isn't ready until it
 * returns. So it only starts the warm-up and returns.
 */
export function register(): void {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	if (process.env.NEXT_PHASE === "phase-production-build") return;
	void import("@/lib/server/warm-instance")
		.then(({ warmInstance }) => warmInstance())
		.catch(() => {});
}
