import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import {
	dim,
	formatTable,
	info,
	error as logError,
	output,
	success,
} from "../lib/output.ts";
import { readActiveProject, writeActiveProject } from "../lib/project-file.ts";

interface ProjectSummary {
	id: string;
	name: string;
	slug: string;
	network: string;
	createdAt: string;
}

/**
 * `sl project` — account-scoped project context.
 *
 * Accounts are single-project: the project is auto-provisioned by the platform
 * API, so there's no create/delete here. `sl project use <slug>` writes
 * `./.secondlayer/project` in cwd so subsequent commands auto-resolve to it.
 */
export function registerProjectCommand(program: Command): void {
	const project = program
		.command("projects")
		.alias("project")
		.description("Manage your Secondlayer project");

	project
		.command("list")
		.alias("ls")
		.description("List projects in your account")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const res = await httpPlatform<{ projects: ProjectSummary[] }>(
					"/api/projects",
				);
				const active = await readActiveProject(
					process.cwd(),
					(await loadConfig()).defaultProject,
				);
				output({
					json: options.json,
					data: { projects: res.projects, active: active?.slug ?? null },
					human: () => {
						if (res.projects.length === 0) {
							info("No project found.");
							return;
						}
						const rows = res.projects.map((p) => [
							p.slug === active?.slug ? `* ${p.slug}` : `  ${p.slug}`,
							p.name,
							p.network,
							new Date(p.createdAt).toLocaleDateString(),
						]);
						console.log(formatTable(["", "Name", "Network", "Created"], rows));
						if (active) {
							console.log(
								dim(`Active: ${active.slug} (from ${active.resolvedFrom})`),
							);
						}
					},
				});
			} catch (err) {
				handleProjectError(err);
			}
		});

	project
		.command("use <slug>")
		.description(
			"Bind this directory to a project (writes ./.secondlayer/project)",
		)
		.action(async (slug: string) => {
			// Confirm the project exists before writing — prevents typos from
			// creating a broken binding.
			try {
				await httpPlatform<{ id: string; slug: string }>(
					`/api/projects/${encodeURIComponent(slug)}`,
				);
			} catch (err) {
				if (err instanceof CliHttpError && err.status === 404) {
					logError(
						`Project "${slug}" not found — run 'sl project list' to see available projects`,
					);
					process.exit(1);
				}
				handleProjectError(err);
			}

			const path = await writeActiveProject(slug, process.cwd());
			success(`Bound to project "${slug}"`);
			info(dim(`Written to ${path}`));
			info(
				dim("Tip: add `.secondlayer/` to .gitignore — it's account-personal."),
			);
		});

	project
		.command("get")
		.description("Show the active project for this directory")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const config = await loadConfig();
			const active = await readActiveProject(
				process.cwd(),
				config.defaultProject,
			);
			output({
				json: options.json,
				data: active
					? { slug: active.slug, source: active.resolvedFrom }
					: null,
				human: () => {
					if (!active) {
						info("No active project.");
						info(dim("Run 'sl project use <slug>' to bind this directory."));
						return;
					}
					console.log(active.slug);
					console.log(dim(`(from ${active.resolvedFrom})`));
				},
			});
		});
}

function handleProjectError(err: unknown): never {
	if (err instanceof CliHttpError) {
		if (err.code === "SESSION_EXPIRED") {
			logError("Session expired. Run: sl login");
			process.exit(1);
		}
		logError(err.message);
		process.exit(1);
	}
	logError(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
