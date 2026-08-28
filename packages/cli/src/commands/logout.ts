import type { Command } from "commander";
import { CliHttpError, httpAt } from "../lib/http.ts";
import { info, success, warn } from "../lib/output.ts";
import { clearSession, readSession } from "../lib/session.ts";
import { loginTarget } from "./login.ts";

export interface LogoutOptions {
	/** Log out of the archive credits account instead of the instance API. */
	credits?: boolean;
}

/**
 * Revoke the session for one target and drop it from the store. Sessions
 * are keyed per URL, so logging out of one never touches the other.
 */
export async function runLogout(opts: LogoutOptions = {}): Promise<void> {
	const target = loginTarget(opts);
	const session = await readSession(target);
	if (!session) {
		info(`Not logged in (${target}).`);
		return;
	}
	try {
		await httpAt(target, "/api/auth/logout", {
			method: "POST",
			bearer: session.token,
		});
	} catch (err) {
		if (err instanceof CliHttpError) {
			warn(
				`Server logout failed (${err.code}); clearing the local session anyway`,
			);
		}
	}
	await clearSession(target);
	success(`Logged out (${target}).`);
}

export function registerLogoutCommand(program: Command): void {
	program
		.command("logout", { hidden: true })
		.description("Log out and revoke the local session")
		.option(
			"--credits",
			"Log out of the archive credits account used by bootstrap, repair, and credits",
		)
		.action((opts: LogoutOptions) => runLogout({ credits: opts.credits }));
}
