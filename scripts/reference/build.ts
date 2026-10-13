/**
 * openpkg spec → reference JSON for the docs site.
 *
 * Pure: takes the parsed spec, a package config and a small IO shim, and
 * returns `{ "<relative path>.json": data }`. `extract.ts` runs openpkg and
 * writes the files; tests feed hand-built specs.
 */
import {
	type RenderContext,
	type Schema,
	type Signature,
	type Tag,
	refName,
	renderDeclaration,
	renderReturns,
	renderType,
} from "./render";
import { locate, restFor } from "./source";
import { type Entry, type RawMethod, type Spec, Walker } from "./walk";

export type SurfaceConfig = {
	slug: string;
	title: string;
	/** Name of the client member that roots this surface (`streams` → `sl.streams`). */
	member?: string;
	/** Client methods that make up this surface (`batch`, `context`). */
	only?: string[];
};

export type ReferenceConfig = {
	/** Package directory relative to the repo root. */
	package: string;
	/** Exported class the surfaces hang off. */
	client: string;
	/** Variable name used in rendered paths (`sl`). */
	variable: string;
	/** URL prefix the docs pages live under; anchors are appended to it. */
	docsBase: string;
	surfaces: SurfaceConfig[];
	/** Property that discriminates overloads (`chain`), and the variant listed first. */
	variant?: { key: string; default: string };
	/** Errors are exported classes descending from this one. */
	errorBase?: string;
};

export type ReferenceIO = {
	/** Source text by repo-relative path, or undefined when absent. */
	readText(path: string): string | undefined;
	/** Example files for a surface, as `{ id, file, code }` (id = method id). */
	examples(surface: string): { id: string; file: string; code: string }[];
};

export type Field = {
	name: string;
	type: string;
	required: boolean;
	description: string;
};

export type ParamDoc = {
	name: string;
	type: string;
	required: boolean;
	description: string;
};

export type Overload = {
	label: string;
	description?: string;
	params: ParamDoc[];
	returns: { type: string; description: string };
};

export type Deprecation = { use: string | null };

export type Method = {
	id: string;
	path: string;
	summary: string;
	description: string;
	deprecated?: Deprecation;
	source: { file: string; line: number } | null;
	rest?: string;
	overloads: Overload[];
	examples: { file: string; code: string }[];
};

export type TypeDoc = {
	name: string;
	summary: string;
	fields?: Field[];
	definition?: string;
	deprecated?: Deprecation;
};

export type SurfaceFile = {
	slug: string;
	root: string;
	methods: Method[];
	types: TypeDoc[];
};

export type ReferenceIndex = {
	package: string;
	version: string;
	generator: string;
	surfaces: {
		slug: string;
		title: string;
		root: string;
		methodCount: number;
	}[];
	helpers: {
		name: string;
		summary: string;
		signature: string;
		source: { file: string; line: number } | null;
	}[];
	errors: { name: string; parent: string; summary: string; status?: number }[];
	symbols: Record<string, string>;
};

export type BuildResult = {
	/** Keyed by path under the output directory. */
	files: Record<string, SurfaceFile | ReferenceIndex>;
	unresolved: { path: string; reason: string }[];
};

const DEFINITION_LIMIT = 600;

/** First sentence of a doc comment: a label, not an essay. */
export function summarize(description: string | undefined): string {
	if (!description) return "";
	const firstPara = description.split("\n\n")[0]?.replace(/\s+/g, " ").trim();
	if (!firstPara) return "";
	const sentence = firstPara.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstPara;
	return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

/** `{@link X}` → a markdown link when `X` has a home, inline code when it does not. */
export function linkify(
	text: string,
	symbols: Readonly<Record<string, string>>,
): string {
	return text.replace(
		/\{@link(?:code|plain)?\s+([^}\s]+)(?:\s+([^}]*))?\}/g,
		(_match, target: string, label: string | undefined) => {
			const shown = label?.trim();
			const href = symbols[target];
			if (!href) return `\`${shown || target}\``;
			return shown ? `[${shown}](${href})` : `[\`${target}\`](${href})`;
		},
	);
}

function deprecation(tags: Tag[]): Deprecation | undefined {
	const tag = tags.find((t) => t.name === "deprecated");
	if (!tag) return undefined;
	const use = tag.text?.match(/\{@link\s+([^}\s]+)/)?.[1];
	return { use: use ?? null };
}

function methodAnchor(id: string): string {
	return `m-${id.replace(/\./g, "-")}`;
}

function normalizeFile(file: string, packageDir: string): string {
	if (file.startsWith("src/")) return `${packageDir}/${file}`;
	return file.replace(/^.*\/packages\//, "packages/");
}

/** Capitalized literal: `"bitcoin"` → `Bitcoin`. */
function variantLabel(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

type Variants = string[];

function createBuilder(spec: Spec, config: ReferenceConfig, io: ReferenceIO) {
	const walker = new Walker(spec);
	const known = new Set<string>([
		...spec.types.map((t) => t.name),
		...spec.exports.map((e) => e.name),
	]);

	/** Literal values the variant property can take in a schema, following refs. */
	function variantsOf(schema: Schema | undefined, depth = 0): Variants {
		const key = config.variant?.key;
		if (!schema || !key || depth > 4) return [];
		if (schema.$ref) {
			const type = walker.typeEntry(refName(schema.$ref));
			return variantsOf(type?.schema, depth + 1);
		}
		const own = schema.properties?.[key];
		if (own?.enum) return own.enum.map(String);
		const arms = schema.allOf ?? schema.anyOf ?? schema.oneOf ?? [];
		return [...new Set(arms.flatMap((a) => variantsOf(a, depth + 1)))];
	}

	function overloadVariants(sig: Signature): Variants {
		return [
			...new Set((sig.parameters ?? []).flatMap((p) => variantsOf(p.schema))),
		];
	}

	/** Default variant first, unknown/any next, other single variants last. */
	function overloadRank(sig: Signature): number {
		const found = overloadVariants(sig);
		if (found.length === 1) return found[0] === config.variant?.default ? 0 : 2;
		return 1;
	}

	function buildOverload(
		sig: Signature,
		label: string,
		multiple: boolean,
		ctx: RenderContext,
	): Overload {
		const params: ParamDoc[] = (sig.parameters ?? []).map((p) => ({
			name: p.name,
			type: renderType(p.schema, ctx),
			required: p.required !== false,
			description: p.description ?? "",
		}));
		const overload: Overload = {
			label,
			params,
			returns: {
				type: renderReturns(sig.returns, ctx),
				description: sig.returns?.description ?? "",
			},
		};
		if (multiple && sig.description) overload.description = sig.description;
		return overload;
	}

	function buildMethod(
		raw: RawMethod,
		rootPath: string,
		ctx: RenderContext,
	): Method {
		const id = raw.segments.join(".");
		const path = [rootPath, ...raw.segments].join(".");
		const ordered = raw.signatures
			.map((sig, index) => ({ sig, index }))
			.sort(
				(a, b) =>
					overloadRank(a.sig) - overloadRank(b.sig) || a.index - b.index,
			)
			.map((x) => x.sig);
		const multiple = ordered.length > 1;
		const overloads = ordered.map((sig, i) => {
			const found = overloadVariants(sig);
			const label =
				found.length === 1 && found[0] !== undefined
					? variantLabel(found[0])
					: found.length > 1 && config.variant
						? `Any ${config.variant.key}`
						: multiple
							? `Overload ${i + 1}`
							: "";
			return buildOverload(sig, label, multiple, ctx);
		});
		const description =
			overloads.find((o) => o.description)?.description ??
			ordered.find((s) => s.description)?.description ??
			raw.description;
		const tags = [...raw.tags, ...ordered.flatMap((s) => s.tags ?? [])];

		let source: Method["source"] = null;
		let rest: string | undefined;
		if (raw.owner?.source) {
			const file = normalizeFile(raw.owner.source.file, config.package);
			const text = io.readText(file);
			const at = text
				? locate(text, raw.owner.source.line, raw.ownerPath)
				: null;
			source = { file, line: at?.line ?? raw.owner.source.line };
			if (text && raw.owner.kind === "class") {
				rest = restFor(text, raw.owner.source.line, raw.ownerPath) ?? undefined;
			}
		}
		const deprecated = deprecation(tags);
		return {
			id,
			path,
			summary: summarize(description),
			description,
			...(deprecated ? { deprecated } : {}),
			source,
			...(rest ? { rest } : {}),
			overloads,
			examples: [],
		};
	}

	/** Fields of an object-ish type; `$ref` arms of an intersection are flattened in. */
	function fieldsOf(schema: Schema, ctx: RenderContext, depth = 0): Field[] {
		if (depth > 3) return [];
		if (schema.$ref) {
			const target = walker.typeEntry(refName(schema.$ref));
			return target?.schema ? fieldsOf(target.schema, ctx, depth + 1) : [];
		}
		if (schema.allOf)
			return schema.allOf.flatMap((a) => fieldsOf(a, ctx, depth + 1));
		const required = new Set(schema.required ?? []);
		return Object.entries(schema.properties ?? {}).map(([name, value]) => ({
			name,
			type: renderType(value, ctx),
			required: required.has(name),
			description: value.description ?? "",
		}));
	}

	function describeType(name: string, ctx: RenderContext): TypeDoc | null {
		const type = walker.typeEntry(name);
		if (!type?.schema) return null;
		const exported = walker.entry(name);
		const doc: TypeDoc = {
			name,
			summary: summarize(exported?.description ?? type.description),
		};
		const byName = new Map<string, Field>();
		for (const f of fieldsOf(type.schema, ctx)) byName.set(f.name, f);
		if (byName.size) {
			doc.fields = [...byName.values()];
		} else if (type.kind !== "class") {
			const text = renderType(type.schema, ctx);
			doc.definition =
				text.length > DEFINITION_LIMIT
					? `${text.slice(0, DEFINITION_LIMIT - 1)}…`
					: text;
		}
		const deprecated = deprecation(exported?.tags ?? type.tags ?? []);
		if (deprecated) doc.deprecated = deprecated;
		return doc;
	}

	/** Types reachable from a surface's signatures, transitively through field types. */
	function typesFor(roots: Set<string>, external: Set<string>): TypeDoc[] {
		const done = new Map<string, TypeDoc>();
		const queue = [...roots].sort();
		while (queue.length) {
			const name = queue.shift();
			if (!name || done.has(name) || external.has(name)) continue;
			const refs = new Set<string>();
			const doc = describeType(name, { known, refs, external });
			if (!doc) continue;
			done.set(name, doc);
			for (const ref of [...refs].sort()) queue.push(ref);
		}
		return [...done.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	return { walker, known, buildMethod, typesFor };
}

function attachExamples(
	slug: string,
	methods: Method[],
	io: ReferenceIO,
): void {
	const byId = new Map(methods.map((m) => [m.id, m]));
	for (const example of io.examples(slug)) {
		const method = byId.get(example.id);
		if (!method) {
			throw new Error(
				`Example ${example.file} names no method "${example.id}" on surface "${slug}".`,
			);
		}
		method.examples.push({ file: example.file, code: example.code });
	}
}

function statusOf(entry: Entry): number | undefined {
	const schema = entry.members?.find((m) => m.name === "status")?.schema;
	const value = schema?.const ?? schema?.enum?.[0];
	return typeof value === "number" ? value : undefined;
}

function errorsOf(spec: Spec, base: string) {
	const byName = new Map(spec.exports.map((e) => [e.name, e]));
	const descends = (entry: Entry, depth = 0): boolean => {
		if (!entry.extends || depth > 10) return false;
		if (entry.extends === base) return true;
		const parent = byName.get(entry.extends);
		return parent ? descends(parent, depth + 1) : false;
	};
	return spec.exports
		.filter((e) => e.kind === "class" && descends(e))
		.map((e) => {
			const status = statusOf(e);
			return {
				name: e.name,
				parent: e.extends ?? base,
				summary: summarize(e.description),
				...(status !== undefined ? { status } : {}),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildReference(
	spec: Spec,
	config: ReferenceConfig,
	io: ReferenceIO,
	generator: string,
): BuildResult {
	const builder = createBuilder(spec, config, io);
	const client = builder.walker.entry(config.client);
	if (!client) throw new Error(`Export "${config.client}" not found in spec.`);

	const symbols: Record<string, string> = {};
	const surfaces: SurfaceFile[] = [];
	const external = new Set<string>();

	for (const surface of config.surfaces) {
		const rawMethods = builder.walker.walkClient(client, {
			member: surface.member,
			only: surface.only,
		});
		const root = surface.member
			? `${config.variable}.${surface.member}`
			: config.variable;
		const refs = new Set<string>();
		const ctx: RenderContext = { known: builder.known, refs, external };
		const seen = new Set<string>();
		const methods: Method[] = [];
		const owners = new Map<string, string>();
		for (const raw of rawMethods) {
			const method = builder.buildMethod(raw, root, ctx);
			if (seen.has(method.id)) continue;
			seen.add(method.id);
			methods.push(method);
			if (raw.owner) {
				owners.set(method.id, [raw.owner.name, ...raw.ownerPath].join("."));
			}
		}
		attachExamples(surface.slug, methods, io);
		const types = builder.typesFor(refs, external);

		for (const m of methods) {
			const href = `${config.docsBase}/${surface.slug}#${methodAnchor(m.id)}`;
			symbols[m.path] = href;
			const alias = owners.get(m.id);
			if (alias && symbols[alias] === undefined) symbols[alias] = href;
		}
		for (const t of types) {
			symbols[t.name] ??= `${config.docsBase}/${surface.slug}#t-${t.name}`;
		}
		surfaces.push({ slug: surface.slug, root, methods, types });
	}

	// Second pass: descriptions can only link once every surface has a home.
	for (const surface of surfaces) {
		for (const m of surface.methods) {
			m.description = linkify(m.description, symbols);
			m.summary = linkify(m.summary, symbols);
			for (const o of m.overloads) {
				if (o.description) o.description = linkify(o.description, symbols);
				for (const p of o.params) {
					p.description = linkify(p.description, symbols);
				}
				o.returns.description = linkify(o.returns.description, symbols);
			}
		}
		for (const t of surface.types) {
			t.summary = linkify(t.summary, symbols);
			for (const f of t.fields ?? []) {
				f.description = linkify(f.description, symbols);
			}
		}
	}

	const helperCtx: RenderContext = { known: builder.known };
	const helpers = spec.exports
		.filter((e) => e.kind === "function" && e.signatures?.[0])
		.map((e) => ({
			name: e.name,
			summary: linkify(summarize(e.description), symbols),
			signature: renderDeclaration(
				e.name,
				e.signatures?.[0] as Signature,
				helperCtx,
			),
			source: e.source
				? {
						file: normalizeFile(e.source.file, config.package),
						line: e.source.line,
					}
				: null,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const index: ReferenceIndex = {
		package: spec.meta.name,
		version: spec.meta.version,
		generator,
		surfaces: surfaces.map((s) => {
			const cfg = config.surfaces.find((c) => c.slug === s.slug);
			return {
				slug: s.slug,
				title: cfg?.title ?? s.slug,
				root: s.root,
				methodCount: s.methods.length,
			};
		}),
		helpers,
		errors: config.errorBase ? errorsOf(spec, config.errorBase) : [],
		symbols: Object.fromEntries(
			Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)),
		),
	};

	const files: BuildResult["files"] = { "index.json": index };
	for (const s of surfaces) files[`${s.slug}.json`] = s;
	return { files, unresolved: builder.walker.unresolved };
}
