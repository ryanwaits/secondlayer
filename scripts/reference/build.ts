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
import { hasHiddenConstructor, locate, restFor } from "./source";
import { type Entry, type RawMethod, type Spec, Walker } from "./walk";

export type SurfaceConfig = {
	slug: string;
	title: string;
	/** Name of the client member that roots this surface (`streams` → `sl.streams`). */
	member?: string;
	/** Client methods that make up this surface (`batch`, `context`). */
	only?: string[];
	/** Document the client class's constructor on this surface. */
	withConstructor?: boolean;
};

type BaseConfig = {
	/** Package directory relative to the repo root. */
	package: string;
	/** URL prefix the docs pages live under; anchors are appended to it. */
	docsBase: string;
	/** Property that discriminates overloads (`chain`), and the variant listed first. */
	variant?: { key: string; default: string };
	/** Errors are exported classes descending from this one. */
	errorBase?: string;
};

/** A client class whose members are the surfaces (`sl.streams`). */
export type ClientReferenceConfig = BaseConfig & {
	/** Exported class the surfaces hang off. */
	client: string;
	/** Variable name used in rendered paths (`sl`). */
	variable: string;
	surfaces: SurfaceConfig[];
};

/**
 * One section of a function-first package. An export belongs to the first
 * group that claims it by name, by `@group` tag or by source file; a function,
 * class or constant no group claims fails the build.
 */
export type GroupConfig = {
	slug: string;
	title: string;
	/** Package-relative source files (`src/define.ts`) whose exports belong here. */
	files?: RegExp;
	/** Exports carrying this JSDoc `@group` tag. */
	tag?: string;
	/** Import specifier when it differs from the package (`@secondlayer/subgraphs/testing`). */
	from?: string;
	/** Exports claimed by name (re-exports whose declaration sits in another package). */
	names?: string[];
	/** Document an exported interface's methods under `root` instead of top-level exports. */
	members?: { type: string; root: string };
};

/** A package of top-level functions, classes and constants, sectioned into groups. */
export type FunctionReferenceConfig = BaseConfig & { groups: GroupConfig[] };

export type ReferenceConfig = ClientReferenceConfig | FunctionReferenceConfig;

export type ReferenceIO = {
	/** Source text by repo-relative path, or undefined when absent. */
	readText(path: string): string | undefined;
	/** Example files for a surface, as `{ id, file, code }` (id = method id). */
	examples(surface: string): { id: string; file: string; code: string }[];
	/**
	 * Whether the package's own source declares a type of this name. openpkg
	 * follows types into sibling workspace packages; a function-first package
	 * documents only what it declares. Absent: every type counts as its own.
	 */
	declares?(name: string): boolean;
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
	/** An options object's own fields, with their docs (constructors). */
	fields?: Field[];
};

export type TypeParam = {
	name: string;
	constraint?: string;
	default?: string;
	const?: true;
};

export type Overload = {
	label: string;
	/** This overload's own JSDoc (markdown); "" when it has none. */
	description: string;
	typeParams?: TypeParam[];
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

export type Constructor = {
	/** The class it constructs (`SecondLayer`). */
	name: string;
	summary: string;
	description: string;
	source: { file: string; line: number } | null;
	overloads: Overload[];
};

/** An exported value that is not callable (`MAINNET_CHECKPOINT`). */
export type Constant = {
	name: string;
	summary: string;
	/** The value's type as text; a literal reads as itself. */
	type: string;
	source: { file: string; line: number } | null;
};

export type SurfaceFile = {
	slug: string;
	/** Function groups: where the names import from, when not the package itself. */
	from?: string;
	/** `sl.streams` for a client surface; empty for a function group. */
	root: string;
	/** The client class's constructor, on the surface that asks for it. */
	constructor?: Constructor;
	methods: Method[];
	/** Function groups only: exported values that are not callable. */
	constants?: Constant[];
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
	return sentence.length > 400 ? `${sentence.slice(0, 397)}…` : sentence;
}

/** A doc that only makes sense for one overload (`chain: "bitcoin"` — …, "Narrowing overload: …"). */
export function isOverloadSpecific(doc: string): boolean {
	const head = doc.slice(0, 200);
	return /^\s*`[\w.]+:\s*"[^"]*"`/.test(head) || /\boverload\b/i.test(head);
}

/** `{@link X}` → a markdown link when `X` has a home, inline code when it does not. */
export function linkify(
	text: string,
	symbols: Readonly<Record<string, string>>,
): string {
	// openpkg pads inline tags with newlines ("see\n\n{@link X}\n."), which would
	// split the sentence; the replacement stays inline.
	return text.replace(
		/(\s*)\{@link(?:code|plain)?\s+([^}\s]+)(?:\s+([^}]*?))?\s*\}(\s*)([.,;:!?)]?)/g,
		(
			_match,
			before: string,
			target: string,
			label: string | undefined,
			after: string,
			punctuation: string,
		) => {
			const shown = label?.trim();
			const href = symbols[target];
			const link = href
				? shown
					? `[${shown}](${href})`
					: `[\`${target}\`](${href})`
				: `\`${shown || target}\``;
			const lead = before.includes("\n") ? " " : before;
			const trail = punctuation ? "" : after.includes("\n") ? " " : after;
			return `${lead}${link}${trail}${punctuation}`;
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
	/** A function-first package documents declarations, not a client's request paths. */
	const functionMode = "groups" in config;
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
		description: string,
		ctx: RenderContext,
		expand = false,
	): Overload {
		const params: ParamDoc[] = (sig.parameters ?? []).map((p) => {
			const fields = expand && p.schema ? fieldsOf(p.schema, ctx) : [];
			return {
				name: p.name,
				type: renderType(p.schema, ctx),
				required: p.required !== false,
				description: p.description ?? "",
				...(fields.length ? { fields } : {}),
			};
		});
		const typeParams: TypeParam[] = (sig.typeParameters ?? []).map((t) => ({
			name: t.name,
			...(t.constraint ? { constraint: t.constraint } : {}),
			...(t.default ? { default: t.default } : {}),
			...(t.const ? { const: true as const } : {}),
		}));
		const overload: Overload = {
			label,
			description,
			...(typeParams.length ? { typeParams } : {}),
			params,
			returns: {
				type: renderReturns(sig.returns, ctx),
				description: sig.returns?.description ?? "",
			},
		};
		return overload;
	}

	/**
	 * Which doc belongs to the method and which to a single overload. openpkg
	 * copies the first declaration's JSDoc onto the method, so a doc is the
	 * method's own only when it is not marked overload-specific and either it is
	 * the only doc or the method has a doc of its own that differs from the
	 * first overload's. Everything else stays on its overload.
	 */
	function splitDocs(raw: RawMethod): {
		methodDoc: string;
		overloadDocs: string[];
	} {
		const own = raw.signatures.map((s) => s.description ?? "");
		const none = own.map(() => "");
		// openpkg repeats one declaration's doc across the signatures it lists
		// for it, so count distinct docs, not documented signatures.
		const documented = new Set(own.filter(Boolean)).size;
		if (own.length === 1) {
			return { methodDoc: own[0] || raw.description, overloadDocs: none };
		}
		if (raw.description && documented > 0 && raw.description !== own[0]) {
			return { methodDoc: raw.description, overloadDocs: own };
		}
		// One doc in total: a shared first-declaration doc, unless it names its overload.
		const first =
			documented === 0
				? raw.description
				: documented === 1
					? (own.find(Boolean) ?? "")
					: "";
		if (first && !isOverloadSpecific(first)) {
			return { methodDoc: first, overloadDocs: none };
		}
		const overloadDocs = documented === 0 ? [...none] : own;
		if (documented === 0 && first) overloadDocs[0] = first;
		return { methodDoc: "", overloadDocs };
	}

	function buildMethod(
		raw: RawMethod,
		rootPath: string,
		ctx: RenderContext,
	): Method {
		const id = raw.segments.join(".");
		const path = [rootPath, ...raw.segments].filter(Boolean).join(".");
		const ranked = raw.signatures
			.map((sig, index) => ({ sig, index }))
			.sort(
				(a, b) =>
					overloadRank(a.sig) - overloadRank(b.sig) || a.index - b.index,
			);
		const ordered = ranked.map((x) => x.sig);
		const multiple = ordered.length > 1;
		const { methodDoc, overloadDocs } = splitDocs(raw);
		const overloads = ranked.map(({ sig, index }, i) => {
			const found = overloadVariants(sig);
			const label =
				found.length === 1 && found[0] !== undefined
					? variantLabel(found[0])
					: found.length > 1 && config.variant
						? `Any ${config.variant.key}`
						: multiple
							? `Overload ${i + 1}`
							: "";
			return buildOverload(sig, label, overloadDocs[index] ?? "", ctx);
		});
		const description = methodDoc;
		const tags = [...raw.tags, ...ordered.flatMap((s) => s.tags ?? [])];

		let source: Method["source"] = null;
		let rest: string | undefined;
		// A declaration openpkg followed into another package's `.d.ts` is not ours to link.
		const ours = !functionMode || raw.owner?.source?.file.startsWith("src/");
		if (raw.owner?.source && ours) {
			const file = normalizeFile(raw.owner.source.file, config.package);
			const text = io.readText(file);
			const at = text
				? locate(text, raw.owner.source.line, raw.ownerPath)
				: null;
			source = { file, line: at?.line ?? raw.owner.source.line };
			if (text && raw.owner.kind === "class" && !functionMode) {
				rest = restFor(text, raw.owner.source.line, raw.ownerPath) ?? undefined;
			}
		}
		const deprecated = deprecation(tags);
		return {
			id,
			path,
			summary: "",
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

	/**
	 * A class listed among the types: its summary and its getters. Its type
	 * schema also carries private members, so the public `members` are read.
	 */
	function describeClass(cls: Entry, ctx: RenderContext): TypeDoc {
		const fields: Field[] = (cls.members ?? [])
			.filter(
				(m) =>
					m.kind === "getter" && (!m.visibility || m.visibility === "public"),
			)
			.map((m) => ({
				name: m.name,
				type: renderType(m.schema, ctx),
				required: true,
				description: m.description ?? m.schema?.description ?? "",
			}));
		const deprecated = deprecation(cls.tags ?? []);
		return {
			name: cls.name,
			summary: cls.description ?? "",
			...(fields.length ? { fields } : {}),
			...(deprecated ? { deprecated } : {}),
		};
	}

	function describeType(name: string, ctx: RenderContext): TypeDoc | null {
		const cls = functionMode ? walker.entry(name) : undefined;
		if (cls?.kind === "class") return describeClass(cls, ctx);
		const type = walker.typeEntry(name);
		if (!type?.schema) return null;
		const exported = walker.entry(name);
		const doc: TypeDoc = {
			name,
			summary: exported?.description ?? type.description ?? "",
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
			if (functionMode && io.declares && !io.declares(name)) continue;
			const refs = new Set<string>();
			const doc = describeType(name, { known, refs, external });
			if (!doc) continue;
			done.set(name, doc);
			for (const ref of [...refs].sort()) queue.push(ref);
		}
		return [...done.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	/** The class's constructor signatures; options objects open into documented fields. */
	function buildConstructor(
		entry: Entry,
		ctx: RenderContext,
	): Constructor | null {
		const signatures = entry.signatures ?? [];
		if (!signatures.length) return null;
		const overloads = signatures.map((sig) => {
			const overload = buildOverload(sig, "", sig.description ?? "", ctx, true);
			// A constructor returns its class; the signature does not repeat it.
			return { ...overload, returns: { type: "", description: "" } };
		});
		const file = entry.source
			? normalizeFile(entry.source.file, config.package)
			: null;
		return {
			name: entry.name,
			summary: "",
			description: entry.description ?? "",
			source: file && entry.source ? { file, line: entry.source.line } : null,
			overloads,
		};
	}

	return { walker, known, buildMethod, buildConstructor, typesFor };
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

function errorsOf(
	spec: Spec,
	base: string,
	symbols: Readonly<Record<string, string>>,
) {
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
				summary: summarize(linkify(e.description ?? "", symbols)),
				...(status !== undefined ? { status } : {}),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Second pass: descriptions can only link once every surface has a home. */
function linkSurfaces(
	surfaces: SurfaceFile[],
	symbols: Readonly<Record<string, string>>,
): void {
	for (const surface of surfaces) {
		// `constructor` is also every object's inherited function: only an own key counts.
		const ctor = Object.prototype.hasOwnProperty.call(surface, "constructor")
			? surface.constructor
			: undefined;
		if (ctor) {
			ctor.description = linkify(ctor.description, symbols);
			ctor.summary = summarize(ctor.description);
			for (const o of ctor.overloads) {
				o.description = linkify(o.description, symbols);
				for (const p of o.params) {
					p.description = linkify(p.description, symbols);
					for (const f of p.fields ?? []) {
						f.description = linkify(f.description, symbols);
					}
				}
			}
		}
		for (const m of surface.methods) {
			m.description = linkify(m.description, symbols);
			m.summary = summarize(m.description);
			for (const o of m.overloads) {
				o.description = linkify(o.description, symbols);
				for (const p of o.params) {
					p.description = linkify(p.description, symbols);
					for (const f of p.fields ?? []) {
						f.description = linkify(f.description, symbols);
					}
				}
				o.returns.description = linkify(o.returns.description, symbols);
			}
		}
		for (const c of surface.constants ?? []) {
			c.summary = summarize(linkify(c.summary, symbols));
		}
		for (const t of surface.types) {
			t.summary = summarize(linkify(t.summary, symbols));
			for (const f of t.fields ?? []) {
				f.description = linkify(f.description, symbols);
			}
		}
	}
}

function buildClientReference(
	spec: Spec,
	config: ClientReferenceConfig,
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
		const ctor = surface.withConstructor
			? builder.buildConstructor(client, ctx)
			: null;
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
		surfaces.push({
			slug: surface.slug,
			root,
			...(ctor ? { constructor: ctor } : {}),
			methods,
			types,
		});
	}

	linkSurfaces(surfaces, symbols);

	const helperCtx: RenderContext = { known: builder.known };
	const helpers = spec.exports
		.filter((e) => e.kind === "function" && e.signatures?.[0])
		.map((e) => ({
			name: e.name,
			summary: summarize(linkify(e.description ?? "", symbols)),
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
		errors: config.errorBase ? errorsOf(spec, config.errorBase, symbols) : [],
		symbols: Object.fromEntries(
			Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)),
		),
	};

	const files: BuildResult["files"] = { "manifest.json": index };
	for (const s of surfaces) files[`${s.slug}.json`] = s;
	return { files, unresolved: builder.walker.unresolved };
}

/** The first group that claims an export: by name, by `@group` tag, then by source file. */
function groupOf(
	entry: Entry,
	groups: readonly GroupConfig[],
): GroupConfig | undefined {
	const file = entry.source?.file ?? "";
	return groups.find(
		(g) =>
			g.names?.includes(entry.name) ||
			(g.tag !== undefined &&
				(entry.tags ?? []).some(
					(t) => t.name === "group" && t.text?.trim() === g.tag,
				)) ||
			g.files?.test(file),
	);
}

const CALLABLE_KINDS = new Set(["function", "class", "variable"]);

/**
 * A package of top-level functions, classes and constants. Each group is one
 * section of one page, so anchors hang off `docsBase` itself. A function is a
 * method; a class is its constructor plus its public members; a namespace
 * object (`on`) is its callable members; a non-callable value is a constant.
 */
function buildFunctionReference(
	spec: Spec,
	config: FunctionReferenceConfig,
	io: ReferenceIO,
	generator: string,
): BuildResult {
	const builder = createBuilder(spec, config, io);
	const { walker } = builder;
	const symbols: Record<string, string> = {};
	const surfaces: SurfaceFile[] = [];
	const external = new Set<string>();

	const owned = new Map<string, Entry[]>(
		config.groups.map((g) => [g.slug, []]),
	);
	for (const entry of spec.exports) {
		const group = groupOf(entry, config.groups);
		if (group) owned.get(group.slug)?.push(entry);
		else if (CALLABLE_KINDS.has(entry.kind)) {
			walker.unresolved.push({
				path: entry.name,
				reason: "no group claims this export",
			});
		}
	}

	for (const group of config.groups) {
		const refs = new Set<string>();
		const ctx: RenderContext = { known: builder.known, refs, external };
		const methods: Method[] = [];
		const constants: Constant[] = [];
		const seen = new Set<string>();
		const add = (method: Method) => {
			if (seen.has(method.id)) return;
			seen.add(method.id);
			methods.push(method);
		};
		const classHomes = new Set<string>();

		if (group.members) {
			const type = walker.entry(group.members.type);
			if (!type) {
				walker.unresolved.push({
					path: group.members.type,
					reason: `group "${group.slug}" documents a type that is not exported`,
				});
			} else {
				for (const raw of walker.walkMembers(type, group.members.root)) {
					add(builder.buildMethod(raw, "", ctx));
				}
			}
		}

		for (const entry of owned.get(group.slug) ?? []) {
			if (entry.kind === "class") {
				const text = entry.source
					? io.readText(normalizeFile(entry.source.file, config.package))
					: undefined;
				const hidden =
					text && entry.source
						? hasHiddenConstructor(text, entry.source.line)
						: false;
				const ctor = hidden ? null : builder.buildConstructor(entry, ctx);
				if (!ctor) {
					// Built by a factory, or by nothing the reader calls (an error
					// class): it is listed with the types, getters and all.
					refs.add(entry.name);
				} else {
					add({
						id: entry.name,
						path: `new ${entry.name}`,
						summary: "",
						description: ctor.description,
						source: ctor.source,
						overloads: ctor.overloads,
						examples: [],
					});
					classHomes.add(entry.name);
				}
			}
			if (CALLABLE_KINDS.has(entry.kind)) {
				const raws = walker.walkExport(entry);
				for (const raw of raws) add(builder.buildMethod(raw, "", ctx));
				if (entry.kind === "variable" && raws.length === 0) {
					const file = entry.source?.file;
					constants.push({
						name: entry.name,
						summary: entry.description ?? "",
						type: truncate(renderType(entry.schema, ctx)),
						source:
							entry.source && file?.startsWith("src/")
								? {
										file: normalizeFile(file, config.package),
										line: entry.source.line,
									}
								: null,
					});
				}
			} else {
				refs.add(entry.name);
			}
		}

		attachExamples(group.slug, methods, io);
		const types = builder.typesFor(refs, external);

		const base = config.docsBase;
		for (const m of methods) {
			const href = `${base}#${methodAnchor(m.id)}`;
			symbols[m.path] = href;
			// `SecondlayerProofSource` in prose or code opens the constructor.
			if (classHomes.has(m.id)) symbols[m.id] = href;
		}
		for (const c of constants) symbols[c.name] ??= `${base}#c-${c.name}`;
		for (const t of types) symbols[t.name] ??= `${base}#t-${t.name}`;
		// A group has no client constructor; `constructor` on the type is only Object's.
		const file: Omit<SurfaceFile, "constructor"> = {
			slug: group.slug,
			root: "",
			...(group.from ? { from: group.from } : {}),
			methods,
			...(constants.length ? { constants } : {}),
			types,
		};
		surfaces.push(file as SurfaceFile);
	}

	linkSurfaces(surfaces, symbols);

	const index: ReferenceIndex = {
		package: spec.meta.name,
		version: spec.meta.version,
		generator,
		surfaces: surfaces.map((s) => ({
			slug: s.slug,
			title: config.groups.find((g) => g.slug === s.slug)?.title ?? s.slug,
			root: s.root,
			methodCount: s.methods.length,
		})),
		helpers: [],
		errors: [],
		symbols: Object.fromEntries(
			Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)),
		),
	};
	const files: BuildResult["files"] = { "manifest.json": index };
	for (const s of surfaces) files[`${s.slug}.json`] = s;
	return { files, unresolved: walker.unresolved };
}

function truncate(text: string): string {
	return text.length > DEFINITION_LIMIT
		? `${text.slice(0, DEFINITION_LIMIT - 1)}…`
		: text;
}

export function buildReference(
	spec: Spec,
	config: ReferenceConfig,
	io: ReferenceIO,
	generator: string,
): BuildResult {
	return "groups" in config
		? buildFunctionReference(spec, config, io, generator)
		: buildClientReference(spec, config, io, generator);
}
