/**
 * `DEV_MODE` bypasses authentication, allows any email past the waitlist,
 * and surfaces magic-link tokens + codes in response bodies — none of
 * which can ever be true on a production host. This helper centralises
 * the check so we can't have a process running with `DEV_MODE=true` in
 * `NODE_ENV=production`.
 *
 * Two layers of safety:
 *   1. `packages/api/src/index.ts` startup guard — process exits if both
 *      flags are set.
 *   2. This helper — every read of `DEV_MODE` goes through here, so even
 *      if the startup guard were bypassed (different entrypoint), the
 *      runtime check still rejects production hosts.
 */
export function isDevMode(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	return process.env.DEV_MODE === "true";
}
