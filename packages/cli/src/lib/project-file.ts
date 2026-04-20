import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { z } from "zod/v4";

/**
 * Per-directory active-project binding (Supabase-style).
 *
 * `sl project use <slug>` writes `./.secondlayer/project` in cwd. The
 * resolver walks up from cwd to find the nearest file, stopping at the
 * first `.git` directory so we never accidentally cross repo boundaries.
 * If no per-dir file is found, falls back to `~/.secondlayer/config.json:
 * defaultProject`.
 *
 * `sl project current` prints `{slug} (from {resolvedFrom})` so the user
 * can always sanity-check which file won.
 */

const ProjectFileSchema = z.object({
	slug: z.string().min(1),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

const FILENAME = "project";
const DIRNAME = ".secondlayer";

export interface ResolvedProject {
	slug: string;
	/** Absolute path to the file (or config.json) the slug came from. */
	resolvedFrom: string;
}

/**
 * Walk from `cwd` upward looking for `<dir>/.secondlayer/project`. Stops at:
 *   - The filesystem root
 *   - The first ancestor containing `.git` (repo boundary)
 *   - The user's home directory (never walks into a sibling user)
 *
 * Returns `null` if nothing is found. Callers fall back to the global
 * `~/.secondlayer/config.json:defaultProject`.
 */
export async function readActiveProject(
	cwd: string,
	globalDefault?: string,
): Promise<ResolvedProject | null> {
	let dir = resolve(cwd);
	const home = resolve(homedir());
	const fsRoot = parsePath(dir).root;

	while (true) {
		const candidate = join(dir, DIRNAME, FILENAME);
		if (existsSync(candidate)) {
			try {
				const raw = await readFile(candidate, "utf8");
				const parsed = ProjectFileSchema.parse(JSON.parse(raw));
				return { slug: parsed.slug, resolvedFrom: candidate };
			} catch {
				// Malformed → keep walking up. Surfacing the error here would be
				// surprising when a parent dir has a valid file.
			}
		}
		// Stop at repo boundary
		if (existsSync(join(dir, ".git"))) break;
		// Stop at home or root
		if (dir === home || dir === fsRoot) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	if (globalDefault) {
		return {
			slug: globalDefault,
			resolvedFrom: join(homedir(), ".secondlayer", "config.json"),
		};
	}
	return null;
}

/**
 * Always writes to `{cwd}/.secondlayer/project`. Never to a parent — that
 * would surprise the user. Creates the directory if missing.
 */
export async function writeActiveProject(
	slug: string,
	cwd: string,
): Promise<string> {
	const dir = join(resolve(cwd), DIRNAME);
	await mkdir(dir, { recursive: true });
	const file = join(dir, FILENAME);
	await writeFile(file, JSON.stringify({ slug }, null, 2) + "\n", "utf8");
	return file;
}
