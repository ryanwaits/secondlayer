import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import { dim, error, formatKeyValue, output } from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";
import { readSession } from "../lib/session.ts";

export function registerWhoamiCommand(program: Command): void {
	program
		.command("whoami")
		.description("Show current authenticated account + active project")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const session = await readSession();
			if (!session) {
				error("Not logged in. Run: sl login");
				process.exit(0);
			}

			// Account + plan
			let plan: string;
			try {
				const account = await httpPlatform<{ email: string; plan: string }>(
					"/api/accounts/me",
				);
				plan = account.plan;
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

			output({
				json: options.json,
				data: {
					email: session.email,
					plan,
					project: active
						? { slug: active.slug, source: active.resolvedFrom }
						: null,
				},
				human: () => {
					const rows: [string, string][] = [];
					rows.push(["Email", session.email]);
					rows.push(["Plan", plan]);
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
