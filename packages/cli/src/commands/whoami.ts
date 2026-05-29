import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import { dim, error, formatKeyValue, output } from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";
import { resolveAuth } from "../lib/resolve-auth.ts";

export function registerWhoamiCommand(program: Command): void {
	program
		.command("whoami")
		.description("Show the active account, credential source, and project")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			// Single source of truth for "who am I + where am I pointed".
			let auth: Awaited<ReturnType<typeof resolveAuth>>;
			try {
				auth = await resolveAuth();
			} catch {
				error("Not logged in. Run: sl login");
				process.exit(1);
			}

			// Identity comes from the API so it's correct in env-key mode too.
			let account: { email: string; plan: string };
			try {
				account = await httpPlatform<{ email: string; plan: string }>(
					"/api/accounts/me",
				);
			} catch (err) {
				if (err instanceof CliHttpError && err.code === "SESSION_EXPIRED") {
					error("Session expired. Run: sl login");
					process.exit(1);
				}
				throw err;
			}

			// Active project (per-dir walk with global fallback)
			const config = await loadConfig();
			const active = await readActiveProject(
				process.cwd(),
				config.defaultProject,
			);
			const authSource = auth.fromEnv ? "API key (env)" : "session";

			output({
				json: options.json,
				data: {
					email: account.email,
					plan: account.plan,
					apiUrl: auth.apiUrl,
					authSource,
					project: active
						? { slug: active.slug, source: active.resolvedFrom }
						: null,
				},
				human: () => {
					const rows: [string, string][] = [];
					rows.push(["Email", account.email]);
					rows.push(["Plan", account.plan]);
					rows.push(["API URL", auth.apiUrl]);
					rows.push(["Auth", dim(authSource)]);
					if (active) {
						rows.push(["Project", active.slug]);
						rows.push(["Project source", dim(active.resolvedFrom)]);
					} else {
						rows.push([
							"Project",
							dim("(none — run `sl project create <name>`)"),
						]);
					}
					console.log(formatKeyValue(rows));
				},
			});
		});
}
