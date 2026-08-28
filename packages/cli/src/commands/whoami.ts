import type { Command } from "commander";
import { resolveApiUrl, resolveArchiveOpsUrl } from "../lib/api-url.ts";
import { loadConfig } from "../lib/config.ts";
import {
	ARCHIVE_LOGIN_COMMAND,
	CliHttpError,
	httpArchiveOps,
	resolveArchiveOpsBearer,
} from "../lib/http.ts";
import { dim, error, formatKeyValue, output } from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";

/**
 * `whoami` answers "which archive credits account will bootstrap, repair,
 * and credits charge". The instance API has no accounts: past loopback it
 * takes an instance token, and that token is never shown or sent here.
 */
export function registerWhoamiCommand(program: Command): void {
	program
		.command("whoami", { hidden: true })
		.description(
			"Show the archive credits account, credential source, and project",
		)
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const creditsUrl = resolveArchiveOpsUrl();
			// Credential source for display; httpArchiveOps resolves the bearer
			// again for the request. Two cheap file reads, one code path.
			const { source } = await resolveArchiveOpsBearer();

			// Identity comes from the merchant so it's correct in env-key mode too.
			let account: { email: string };
			try {
				account = await httpArchiveOps<{ email: string }>("/api/accounts/me");
			} catch (err) {
				if (err instanceof CliHttpError) {
					error(err.message);
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
			const authSource =
				source === "env"
					? "API key (env)"
					: `session (${ARCHIVE_LOGIN_COMMAND})`;

			output({
				json: options.json,
				data: {
					email: account.email,
					creditsUrl,
					apiUrl: resolveApiUrl(),
					authSource,
					project: active
						? { slug: active.slug, source: active.resolvedFrom }
						: null,
				},
				human: () => {
					const rows: [string, string][] = [];
					rows.push(["Email", account.email]);
					rows.push(["Credits API", creditsUrl]);
					rows.push(["Instance API", resolveApiUrl()]);
					rows.push(["Auth", dim(authSource)]);
					if (active) {
						rows.push(["Project", active.slug]);
						rows.push(["Project source", dim(active.resolvedFrom)]);
					} else {
						rows.push(["Project", dim("(none)")]);
					}
					console.log(formatKeyValue(rows));
				},
			});
		});
}
