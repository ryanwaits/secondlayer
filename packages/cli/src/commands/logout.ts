import type { Command } from "commander";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import { info, success, warn } from "../lib/output.ts";
import { clearSession, readSession } from "../lib/session.ts";

export function registerLogoutCommand(program: Command): void {
	program
		.command("logout")
		.description("Log out and revoke the local session")
		.action(async () => {
			const session = await readSession();
			if (!session) {
				info("Not logged in.");
				return;
			}
			try {
				await httpPlatform("/api/auth/logout", { method: "POST" });
			} catch (err) {
				if (err instanceof CliHttpError) {
					warn(
						`Server logout failed (${err.code}) — clearing local session anyway`,
					);
				}
			}
			await clearSession();
			success("Logged out.");
		});
}
