/**
 * Generates a package's docs reference from its own TypeScript source, via
 * openpkg: `apps/web/src/generated/reference/<package>/` with an `index.json`
 * and one `<surface>.json` per surface.
 *
 * Callers pass a config; see `packages/sdk/scripts/sync-openpkg.ts`.
 * Output is deterministic (no timestamps), so CI can regenerate and diff.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import {
	type ReferenceConfig,
	type ReferenceIO,
	buildReference,
} from "./build";
import { distillLegacySpec } from "./legacy-spec";
import type { Spec } from "./walk";

export const REPO_ROOT = join(import.meta.dir, "../..");

export type ExtractConfig = ReferenceConfig & {
	/** Entry file inside the package, e.g. `src/index.ts`. */
	entry: string;
	/** Output directory relative to the repo root. */
	out: string;
	/** Also write the old single-file distillation here (relative to repo root). */
	legacyOut?: string;
};

/** Reads repo-relative sources and `<package>/examples/<surface>/<method id>.ts`. */
export function fileSystemIO(
	repoRoot: string,
	packageDir: string,
): ReferenceIO {
	return {
		readText(path) {
			const abs = join(repoRoot, path);
			return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
		},
		examples(surface) {
			const dir = join(repoRoot, packageDir, "examples", surface);
			if (!existsSync(dir)) return [];
			return readdirSync(dir)
				.sort()
				.filter((f) => f.endsWith(".ts"))
				.map((f) => ({
					id: f.slice(0, -".ts".length),
					file: `${packageDir}/examples/${surface}/${f}`,
					code: readFileSync(join(dir, f), "utf8"),
				}));
		},
	};
}

function format(data: unknown): string {
	return `${JSON.stringify(data, null, "\t")}\n`;
}

export async function extractReference(config: ExtractConfig): Promise<void> {
	const packageAbs = join(REPO_ROOT, config.package);
	const tmp = join(packageAbs, ".openpkg-spec.json");
	await $`bunx openpkg spec ${config.entry} -o ${tmp}`.cwd(packageAbs).quiet();

	const spec = (await Bun.file(tmp).json()) as Spec;
	await rm(tmp, { force: true });

	// openpkg's meta.name is derived from the entry file, so take the real
	// identity from package.json.
	const pkg = (await Bun.file(join(packageAbs, "package.json")).json()) as {
		name: string;
		version: string;
	};
	spec.meta = { ...spec.meta, name: pkg.name, version: pkg.version };

	const cli = (await Bun.file(
		join(REPO_ROOT, "node_modules/@openpkg-ts/cli/package.json"),
	).json()) as { version: string };

	const { files, unresolved } = buildReference(
		spec,
		config,
		fileSystemIO(REPO_ROOT, config.package),
		`openpkg ${cli.version}`,
	);
	if (unresolved.length) {
		const list = unresolved.map((u) => `  ${u.path}: ${u.reason}`).join("\n");
		throw new Error(`Reference walker could not resolve:\n${list}`);
	}

	const outDir = join(REPO_ROOT, config.out);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	for (const [name, data] of Object.entries(files)) {
		await writeFile(join(outDir, name), format(data));
	}

	if (config.legacyOut) {
		const legacy = join(REPO_ROOT, config.legacyOut);
		await mkdir(join(legacy, ".."), { recursive: true });
		await writeFile(legacy, format(distillLegacySpec(spec, pkg)));
	}

	const methods = Object.values(files).reduce(
		(n, f) => n + ("methods" in f ? f.methods.length : 0),
		0,
	);
	console.log(
		`✓ ${config.out} — ${methods} methods across ${config.surfaces.length} surfaces (${(await readdir(outDir)).length} files)`,
	);
}
