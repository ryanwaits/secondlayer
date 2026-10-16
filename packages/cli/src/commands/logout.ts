import type { Command } from "commander";
import { CliHttpError, httpAt } from "../lib/http.ts";
import { info, success, warn } from "../lib/output.ts";
import { clearSession, readSession } from "../lib/session.ts";
import { loginTarget } from "./login.ts";

/** Revoke your account session on the server and drop it from the store. */
export async function runLogout(): Promise<void> {
	const target = loginTarget();
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
		.command("logout")
		.description("Sign this machine out of your Secondlayer account")
		.action(() => runLogout());
}
