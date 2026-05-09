import { runLoginFlow } from "../commands/login.ts";
import { info } from "./output.ts";
import { readSession } from "./session.ts";

/**
 * Ensure the user has a CLI session. If not, runs the magic-link login flow
 * and returns once a session is persisted. Use at the entry point of any
 * subcommand that hits the platform API on a non-local network.
 *
 * Skips the prompt entirely when a session already exists — does not validate
 * server-side; the next API call will fail with 401 and the user can re-login.
 */
export async function requireAuth(): Promise<void> {
	const session = await readSession();
	if (session) return;
	info("You're not logged in. Starting login flow.");
	await runLoginFlow();
}
