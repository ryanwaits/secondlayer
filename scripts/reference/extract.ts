/**
 * Generates a package's docs reference from its own TypeScript source, via
 * openpkg: `apps/web/src/generated/reference/<package>/` with an `manifest.json`
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
import type { Spec } from "./walk";

export const REPO_ROOT = join(import.meta.dir, "../..");

export type ExtractConfig = ReferenceConfig & {
	/**
	 * Entry file inside the package, e.g. `src/index.ts`. A package with subpath
	 * exports lists one per entry: openpkg reads each, and the specs are merged
	 * (the first entry wins a name both export).
	 */
	entry: string | string[];
	/** Output directory relative to the repo root. */
	out: string;
};

/** Reads repo-relative sources and `<package>/examples/<surface>/<method id>.ts`. */
export function fileSystemIO(
	repoRoot: string,
	packageDir: string,
): ReferenceIO {
	let declared: Set<string> | undefined;
	return {
		declares(name) {
			if (!declared) {
				declared = new Set();
				const src = join(repoRoot, packageDir, "src");
				for (const file of readdirSync(src, { recursive: true })) {
					const rel = String(file);
					if (!rel.endsWith(".ts") || /\.(type-)?test\.ts$/.test(rel)) continue;
					const text = readFileSync(join(src, rel), "utf8");
					for (const m of text.matchAll(
						/^[ \t]*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:type|interface|class|enum)\s+([A-Za-z_$][\w$]*)\s*(?:<|=|\{|extends|implements)/gm,
					))
						if (m[1]) declared.add(m[1]);
				}
			}
			return declared.has(name);
		},
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

/** One spec out of several entries: exports and types by name, first entry first. */
export function mergeSpecs(specs: Spec[]): Spec {
	const [first, ...rest] = specs;
	if (!first) throw new Error("No openpkg spec to merge.");
	const exports = new Map(first.exports.map((e) => [e.name, e]));
	const types = new Map(first.types.map((t) => [t.name, t]));
	for (const spec of rest) {
		for (const e of spec.exports)
			if (!exports.has(e.name)) exports.set(e.name, e);
		for (const t of spec.types) if (!types.has(t.name)) types.set(t.name, t);
	}
	return {
		meta: first.meta,
		exports: [...exports.values()],
		types: [...types.values()],
	};
}

async function readSpec(packageAbs: string, entry: string): Promise<Spec> {
	const tmp = join(packageAbs, ".openpkg-spec.json");
	await $`bunx openpkg spec ${entry} -o ${tmp}`.cwd(packageAbs).quiet();
	const spec = (await Bun.file(tmp).json()) as Spec;
	await rm(tmp, { force: true });
	return spec;
}

export async function extractReference(config: ExtractConfig): Promise<void> {
	const packageAbs = join(REPO_ROOT, config.package);
	// One at a time: every run writes the same temp file.
	const specs: Spec[] = [];
	for (const entry of [config.entry].flat()) {
		specs.push(await readSpec(packageAbs, entry));
	}
	const spec = mergeSpecs(specs);

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

	const methods = Object.values(files).reduce(
		(n, f) => n + ("methods" in f ? f.methods.length : 0),
		0,
	);
	console.log(
		`✓ ${config.out} — ${methods} methods across ${Object.keys(files).length - 1} sections (${(await readdir(outDir)).length} files)`,
	);
}
