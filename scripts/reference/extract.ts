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

/** A doc comment directly above a `type` or `interface` declaration. */
const TYPE_DOC =
	/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/[ \t]*\n[ \t]*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\s*(?:<|=|\{|extends)/g;

function commentText(body: string): string {
	const lines = body.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim());
	const tag = lines.findIndex((l) => l.startsWith("@"));
	return (tag === -1 ? lines : lines.slice(0, tag)).join("\n").trim();
}

/** `type Name = Other;`: a name for one other type, nothing added. */
const BARE_ALIAS =
	/^[ \t]*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gm;

const TYPE_DECLARATION =
	/^[ \t]*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)\s*(?:<|=|\{|extends)/gm;

type TypeNotes = {
	/** Every type name the source declares. */
	declared: Set<string>;
	docs: Map<string, string>;
	aliases: Map<string, string>;
};

/** Type docs and bare aliases of one package's source, by type name. */
function readTypeNotes(srcDir: string): TypeNotes {
	const notes: TypeNotes = {
		declared: new Set(),
		docs: new Map(),
		aliases: new Map(),
	};
	if (!existsSync(srcDir)) return notes;
	for (const file of readdirSync(srcDir, { recursive: true })) {
		const rel = String(file);
		if (!rel.endsWith(".ts") || /\.(type-)?test\.ts$/.test(rel)) continue;
		const text = readFileSync(join(srcDir, rel), "utf8");
		for (const m of text.matchAll(TYPE_DECLARATION))
			if (m[1]) notes.declared.add(m[1]);
		for (const m of text.matchAll(TYPE_DOC)) {
			const name = m[2];
			const doc = commentText(m[1] ?? "");
			if (name && doc && !notes.docs.has(name)) notes.docs.set(name, doc);
		}
		for (const m of text.matchAll(BARE_ALIAS)) {
			const [, name, target] = m;
			if (name && target && !notes.aliases.has(name))
				notes.aliases.set(name, target);
		}
	}
	return notes;
}

/** Reads repo-relative sources and `<package>/examples/<surface>/<method id>.ts`. */
export function fileSystemIO(
	repoRoot: string,
	packageDir: string,
): ReferenceIO {
	let declared: Set<string> | undefined;
	let notes: TypeNotes | undefined;
	/**
	 * The package's own source wins; siblings fill in the types its signatures
	 * borrow, but never a name it declares itself. `shared` comes first: it is
	 * where the workspace's common types live.
	 */
	const typeNotes = (): TypeNotes => {
		if (!notes) {
			const merged = readTypeNotes(join(repoRoot, packageDir, "src"));
			const siblings = readdirSync(join(repoRoot, "packages")).sort(
				(a, b) => Number(b === "shared") - Number(a === "shared"),
			);
			for (const sibling of siblings) {
				const more = readTypeNotes(join(repoRoot, "packages", sibling, "src"));
				for (const name of more.declared) {
					if (merged.declared.has(name)) continue;
					merged.declared.add(name);
					const doc = more.docs.get(name);
					if (doc) merged.docs.set(name, doc);
					const alias = more.aliases.get(name);
					if (alias) merged.aliases.set(name, alias);
				}
			}
			notes = merged;
		}
		return notes;
	};
	return {
		typeDoc: (name) => typeNotes().docs.get(name),
		aliasOf: (name) => typeNotes().aliases.get(name),
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
