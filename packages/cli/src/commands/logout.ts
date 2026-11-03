import type { Command } from "commander";
import { CliHttpError, httpAt } from "../lib/http.ts";
import { info, success, warn } from "../lib/output.ts";
import { clearSession, readSession } from "../lib/session.ts";
import { loginTarget } from "./login.ts";

/** Sign this machine out. A browser-login session is revoked on the server;
 *  a key saved by `login --with-token` is only removed from this machine,
 *  since keys are revoked on the Keys tab, not by logging out. */
export async function runLogout(): Promise<void> {
	const target = loginTarget();
	const session = await readSession(target);
	if (!session) {
		info(`Not logged in (${target}).`);
		return;
	}
	const isSession = session.token.startsWith("ss-sl_");
	if (isSession) {
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
	}
	await clearSession(target);
	success(`Logged out (${target}).`);
	if (!isSession) {
		info(
			"Removed the saved key from this machine. The key stays active; revoke it on the Keys tab.",
		);
	}
}

export function registerLogoutCommand(program: Command): void {
	program
		.command("logout")
		.description("Sign this machine out of your Secondlayer account")
		.action(() => runLogout());
}
