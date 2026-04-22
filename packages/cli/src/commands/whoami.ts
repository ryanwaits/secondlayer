import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import { dim, error, formatKeyValue } from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";
import { readSession } from "../lib/session.ts";

export function registerWhoamiCommand(program: Command): void {
	program
		.command("whoami")
		.description("Show current authenticated account + active project + tenant")
		.action(async () => {
			const session = await readSession();
			if (!session) {
				error("Not logged in. Run: sl login");
				process.exit(0);
			}

			const rows: [string, string][] = [];
			rows.push(["Email", session.email]);

			// Account + plan
			try {
				const account = await httpPlatform<{ email: string; plan: string }>(
					"/api/accounts/me",
				);
				rows.push(["Plan", account.plan]);
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
			if (active) {
				rows.push(["Project", active.slug]);
				rows.push(["Project source", dim(active.resolvedFrom)]);
			} else {
				rows.push(["Project", dim("(none — run `sl project create <name>`)")]);
			}

			// Tenant info — best effort
			try {
				const tenant = await httpPlatform<{
					tenant: {
						slug: string;
						plan: string;
						status: string;
						apiUrl: string;
					} | null;
				}>("/api/tenants/me");
				if (tenant.tenant) {
					rows.push(["Instance", tenant.tenant.apiUrl]);
					rows.push(["Plan", tenant.tenant.plan]);
					rows.push(["Status", tenant.tenant.status]);
				} else {
					rows.push([
						"Instance",
						dim("(none — run `sl instance create --plan launch`)"),
					]);
				}
			} catch {
				// Tenant fetch failing shouldn't break whoami.
			}

			console.log(formatKeyValue(rows));
		});
}
