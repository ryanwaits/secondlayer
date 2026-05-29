import { input } from "@inquirer/prompts";
import type { Command } from "commander";
import { loadConfig, saveConfig } from "../lib/config.ts";
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

interface ProjectCreateOptions {
	slug?: string;
}

/**
 * `sl project` — account-scoped project management.
 *
 * Each project maps 1:1 to a dedicated-hosting tenant (enforced at the
 * platform API). `sl project use <slug>` writes `./.secondlayer/project` in
 * cwd so subsequent commands auto-resolve to this project's tenant.
 */
export function registerProjectCommand(program: Command): void {
	const project = program
		.command("projects")
		.alias("project")
		.description("Manage Secondlayer projects");

	project
		.command("create [name]")
		.description("Create a new project")
		.option("--slug <slug>", "Project URL identifier")
		.action(async (nameArg?: string, options: ProjectCreateOptions = {}) => {
			const name =
				nameArg ??
				(await input({
					message: "Project name",
					validate: (v: string) =>
						v.length >= 2 ? true : "Name must be at least 2 characters",
				}));
			const slug = options.slug ?? slugifyProjectName(name);
			const validation = validateProjectSlug(slug);
			if (validation !== true) {
				logError(`${validation}. Pass --slug <slug> to choose one explicitly.`);
				process.exit(1);
			}

			try {
				const res = await httpPlatform<ProjectSummary>("/api/projects", {
					method: "POST",
					body: { name, slug },
				});
				success(`Created project ${res.name} (${res.slug})`);
				// First project becomes the global default (most users have one).
				// Subsequent projects don't overwrite — switch with `sl project use`.
				const config = await loadConfig();
				if (!config.defaultProject) {
					await saveConfig({ ...config, defaultProject: res.slug });
					info(dim("Set as your default project."));
				} else {
					info(dim(`To use this project, run: sl project use ${res.slug}`));
				}
				info(dim("Next: sl subgraphs deploy <file.ts>"));
			} catch (err) {
				handleProjectError(err);
			}
		});

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
							info(
								"No projects yet — run `sl project create <name>` to start.",
							);
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
		.alias("current")
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
						info(
							dim("Run 'sl project create <name>' or 'sl project use <slug>'."),
						);
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

export function slugifyProjectName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/g, "");
}

export function validateProjectSlug(slug: string): true | string {
	if (slug.length < 2 || slug.length > 63) {
		return "Project slug must be 2-63 characters";
	}
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
		return "Project slug must use lowercase letters, numbers, and hyphens, and start/end with a letter or number";
	}
	return true;
}
