import archive from "@/generated/reference/sdk/archive.json";
import client from "@/generated/reference/sdk/client.json";
import contracts from "@/generated/reference/sdk/contracts.json";
import index from "@/generated/reference/sdk/index.json";
import instance from "@/generated/reference/sdk/instance.json";
import manifestJson from "@/generated/reference/sdk/manifest.json";
import streams from "@/generated/reference/sdk/streams.json";
import subgraphs from "@/generated/reference/sdk/subgraphs.json";
import webhooks from "@/generated/reference/sdk/webhooks.json";
/**
 * The SDK reference's data: the files `bun run openpkg` writes under
 * `generated/reference/sdk`, plus the pure rules that turn them into what the
 * pages show (signatures, parameter rows, REST links). Nothing here renders;
 * `sdk-reference.tsx` and the markdown twin both read it, so the two cannot
 * disagree.
 */
import { parseAnnotations } from "@/lib/code/annotations";

export type Field = {
	name: string;
	type: string;
	required: boolean;
	description: string;
};

export type TypeParam = {
	name: string;
	constraint?: string;
	default?: string;
	const?: true;
};

export type Overload = {
	label: string;
	description: string;
	typeParams?: TypeParam[];
	params: Field[];
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

export type Surface = {
	slug: string;
	root: string;
	methods: Method[];
	types: TypeDoc[];
};

export type Manifest = {
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

const SURFACES = {
	archive,
	client,
	contracts,
	index,
	instance,
	streams,
	subgraphs,
	webhooks,
} as unknown as Record<string, Surface>;

export function manifest(): Manifest {
	return manifestJson as unknown as Manifest;
}

export function surface(slug: string): Surface {
	const found = SURFACES[slug];
	if (!found) throw new Error(`No SDK reference surface "${slug}"`);
	return found;
}

/** Same rule as `scripts/reference/build.ts`; a test pins it to `symbols`. */
export function methodAnchor(id: string): string {
	return `m-${id.replace(/\./g, "-")}`;
}

export const typeAnchor = (name: string) => `t-${name}`;
export const helperAnchor = (name: string) => `h-${name}`;
export const errorAnchor = (name: string) => `e-${name}`;

// ── types as text ──────────────────────────────────────────────────────

const OPEN = new Set(["<", "(", "[", "{"]);
const CLOSE = new Set([">", ")", "]", "}"]);

/** Split `text` on `sep` where it is not nested in brackets, generics or quotes. */
export function splitTop(text: string, sep: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i] as string;
		if (quote) {
			if (c === "\\") i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") quote = c;
		else if (c === "=" && text[i + 1] === ">") i++;
		else if (OPEN.has(c)) depth++;
		else if (CLOSE.has(c)) depth--;
		else if (c === sep && depth === 0) {
			parts.push(text.slice(from, i).trim());
			from = i + 1;
		}
	}
	parts.push(text.slice(from).trim());
	return parts.filter(Boolean);
}

/**
 * Break a long type across lines: intersection and union arms one per line,
 * object members one per line. A type that fits stays on one line, and what
 * has no break point (generic arguments, a long literal union inside an array)
 * stays long.
 */
export function formatType(type: string, indent = 0, width = 80): string {
	const text = type.trim();
	if (indent + text.length <= width) return text;
	const pad = " ".repeat(indent);
	for (const op of ["&", "|"]) {
		const arms = splitTop(text, op);
		if (arms.length > 1) {
			return arms
				.map((arm) => formatType(arm, indent, width))
				.join(`\n${pad}${op} `);
		}
	}
	if (text.startsWith("{") && text.endsWith("}")) {
		const members = splitTop(text.slice(1, -1), ";");
		if (members.length === 0) return text;
		const inner = " ".repeat(indent + 2);
		const lines = members.map((member) => {
			const colon = member.search(/\??:\s/);
			if (colon < 0) return `${inner}${member};`;
			const head = member.slice(0, member.indexOf(":", colon) + 1);
			const value = member.slice(head.length).trim();
			return `${inner}${head} ${formatType(value, indent + 2, width)};`;
		});
		return `{\n${lines.join("\n")}\n${pad}}`;
	}
	return text;
}

function typeParamsText(params: TypeParam[] | undefined): string {
	if (!params?.length) return "";
	const each = params.map(
		(p) =>
			`${p.const ? "const " : ""}${p.name}${p.constraint ? ` extends ${p.constraint}` : ""}${p.default ? ` = ${p.default}` : ""}`,
	);
	return `<${each.join(", ")}>`;
}

/** The ref name a parameter or field carries between its table row and the code. */
const REF_BEFORE = "(?<![\\w.])";

/**
 * One overload's signature as TypeScript: the method's path, its parameters
 * and what it returns. Parameter names get `!ref` annotations, so a hovered
 * table row lights them. The path itself is a ref too, which keeps the block
 * from linking the method to its own entry.
 */
export function signatureOf(
	method: Method,
	overload: Overload,
	refNames: ReadonlySet<string>,
): string {
	const head = `${method.path}${typeParamsText(overload.typeParams)}`;
	const params = overload.params.map(
		(p) => `${p.name}${p.required ? "" : "?"}: ${formatType(p.type, 2, 76)}`,
	);
	const returns = formatType(overload.returns.type, 0, 80);
	const oneLine = `${head}(${params.join(", ")}): ${returns}`;
	const code =
		oneLine.length <= 88 && !oneLine.includes("\n")
			? oneLine
			: `${head}(${params.length ? `\n${params.map((p) => indentLines(p, 2)).join(",\n")},\n` : ""}): ${returns}`;
	return withRefs(code, refNames, `^${escapeRegex(method.path)}`, "method");
}

function indentLines(text: string, by: number): string {
	// The first line is already placed by the caller's join; continuation lines are pre-indented by formatType.
	return `${" ".repeat(by)}${text}`;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** `!ref` annotation lines above each line that opens with (or contains) a known name as a key. */
export function withRefs(
	code: string,
	names: ReadonlySet<string>,
	headPattern?: string,
	headName?: string,
): string {
	const out: string[] = [];
	for (const line of code.split("\n")) {
		if (headPattern && headName && new RegExp(headPattern).test(line))
			out.push(`// !ref[/${headPattern}/] ${headName}`);
		for (const name of names) {
			if (!/^[A-Za-z_]\w*$/.test(name)) continue;
			const key = `${REF_BEFORE}${name}(?=\\??:)`;
			if (new RegExp(key).test(line)) out.push(`// !ref[/${key}/] ${name}`);
		}
		out.push(line);
	}
	return out.join("\n");
}

/** What an example file may annotate with: marks that explain, never ones that change what the block shows. */
const EXAMPLE_ANNOTATIONS = new Set(["callout", "mark", "link"]);

/**
 * Example code with a `!ref` above each line that names a field as an object
 * key. A reference example may mark and call out; focus, diff, collapse,
 * errors, picks and refs of its own would change what the block shows, so they
 * fail the build instead of rendering.
 */
export function exampleWithRefs(
	code: string,
	names: ReadonlySet<string>,
	file = "example",
): string {
	for (const a of parseAnnotations(code, "typescript").annotations)
		if (!EXAMPLE_ANNOTATIONS.has(a.name))
			throw new Error(
				`${file}: "!${a.name}" is not allowed in a reference example (only ${[...EXAMPLE_ANNOTATIONS].join(", ")}).`,
			);
	const out: string[] = [];
	for (const line of code.split("\n")) {
		if (!/^\s*\/\//.test(line)) {
			for (const name of names) {
				if (!/^[A-Za-z_]\w*$/.test(name)) continue;
				const key = `${REF_BEFORE}${name}(?=\\s*:)`;
				if (new RegExp(key).test(line)) out.push(`// !ref[/${key}/] ${name}`);
			}
		}
		out.push(line);
	}
	return out.join("\n");
}

// ── parameters ─────────────────────────────────────────────────────────

export type ParamRow = Field & {
	/** Variants this parameter belongs to, when it is not on every overload (`Bitcoin`). */
	only?: string;
};

const baseName = (type: string) => /^([A-Za-z_]\w*)/.exec(type.trim())?.[1];

/** `a: string; b?: number` members of an object literal's body. */
function memberFields(body: string): Field[] {
	return splitTop(body, ";").flatMap((member) => {
		const m = /^(readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(
			member,
		);
		return m
			? [
					{
						name: m[2] as string,
						type: (m[4] as string).trim(),
						required: !m[3],
						description: "",
					},
				]
			: [];
	});
}

/**
 * The fields of an options type: a named type with fields, an inline object,
 * or an intersection of both (later arms refine earlier ones, keeping their
 * docs). Null when the type is not a plain object, so it stays one row.
 */
export function fieldsOfType(
	type: string,
	types: ReadonlyMap<string, TypeDoc>,
): Field[] | null {
	const text = type.trim();
	if (splitTop(text, "|").length > 1) return null;
	const merged = new Map<string, Field>();
	for (const arm of splitTop(text, "&")) {
		let fields: Field[] | undefined;
		if (arm.startsWith("{") && arm.endsWith("}")) {
			fields = memberFields(arm.slice(1, -1));
		} else if (/^[A-Za-z_]\w*(<[\s\S]*>)?$/.test(arm)) {
			fields = types.get(baseName(arm) ?? "")?.fields;
		}
		if (!fields) return null;
		for (const f of fields) {
			const before = merged.get(f.name);
			merged.set(f.name, {
				...f,
				description: f.description || before?.description || "",
			});
		}
	}
	return merged.size ? [...merged.values()] : null;
}

/**
 * The rows of a method's parameter table: object parameters open into their
 * fields, other parameters are a row each, and overloads are merged by name.
 * A row on only some overloads says which (`Bitcoin`) when the overloads are
 * named variants.
 */
export function paramRows(
	method: Method,
	types: ReadonlyMap<string, TypeDoc>,
): ParamRow[] {
	const rows = new Map<string, ParamRow & { present: Set<number> }>();
	method.overloads.forEach((overload, at) => {
		const nested = overload.params.length > 1;
		for (const param of overload.params) {
			const opened = fieldsOfType(param.type, types);
			const fields: Field[] = opened
				? opened.map((f) => ({
						...f,
						name: nested ? `${param.name}.${f.name}` : f.name,
					}))
				: [param];
			for (const field of fields) {
				const row = rows.get(field.name);
				if (row) {
					row.present.add(at);
					if (!row.description && field.description)
						row.description = field.description;
				} else rows.set(field.name, { ...field, present: new Set([at]) });
			}
		}
	});
	const all = method.overloads.length;
	const variant = (label: string) => /^[A-Z][a-z]+( chain)?$/.test(label);
	return [...rows.values()].map(({ present, ...row }) => {
		if (present.size === all) return row;
		const labels = [
			...new Set([...present].map((i) => method.overloads[i]?.label ?? "")),
		];
		const every = new Set(method.overloads.map((o) => o.label));
		return labels.length < every.size && labels.every(variant)
			? { ...row, only: labels.join(" · ") }
			: row;
	});
}

/** A field's name as the code spells it: `opts.chain` is `chain` in an object. */
export const refKey = (name: string) => name.split(".").pop() ?? name;

/** Options past this many in a group fold behind a disclosure. */
export const OPTIONS_SHOWN = 8;
const FOLD_SLACK = 2;

export type ParamGroup = {
	title: string;
	shown: ParamRow[];
	folded: ParamRow[];
};

/**
 * Required first, then everything else as Options, in the order the type
 * declares them. Past `OPTIONS_SHOWN`, the rest fold.
 */
export function groupParams(rows: ParamRow[]): ParamGroup[] {
	const required = rows.filter((r) => r.required);
	const options = rows.filter((r) => !r.required);
	const groups: ParamGroup[] = [];
	if (required.length)
		groups.push({ title: "Required", shown: required, folded: [] });
	if (options.length) {
		const fold = options.length > OPTIONS_SHOWN + FOLD_SLACK;
		groups.push({
			title: "Options",
			shown: fold ? options.slice(0, OPTIONS_SHOWN) : options,
			folded: fold ? options.slice(OPTIONS_SHOWN) : [],
		});
	}
	return groups;
}

/** Cut a type for a table cell; the full text is in the signature. */
export function shortType(type: string, max = 56): string {
	const flat = type.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export type Callback = { param: string; type: string; fields: Field[] };

/**
 * The `ctx` argument of the callbacks in a method's parameters
 * (`ctx: ConsumerBatchContext`), once per type, when the type has documented
 * fields and is not a deprecated alias.
 */
export function callbackArgs(
	rows: ParamRow[],
	types: ReadonlyMap<string, TypeDoc>,
): Callback[] {
	const found = new Map<string, Callback>();
	for (const row of rows) {
		const arrow = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*=>/.exec(
			row.type.trim(),
		);
		if (!arrow) continue;
		for (const arg of splitTop(arrow[1] as string, ",")) {
			const m = /^ctx\??:\s*(.+)$/.exec(arg);
			const name = m ? baseName(m[1] as string) : undefined;
			const doc = name ? types.get(name) : undefined;
			if (
				m &&
				name &&
				doc?.fields?.length &&
				!doc.deprecated &&
				!found.has(name)
			)
				found.set(name, {
					param: "ctx",
					type: (m[1] as string).trim(),
					fields: doc.fields,
				});
		}
	}
	return [...found.values()];
}

/** The fields of what a method returns, looking through `Promise<…>`. */
export function returnFields(
	overload: Overload,
	types: ReadonlyMap<string, TypeDoc>,
): Field[] {
	let type = overload.returns.type.trim();
	const promise = /^Promise<([\s\S]*)>$/.exec(type);
	if (promise) type = (promise[1] as string).trim();
	return types.get(baseName(type) ?? "")?.fields ?? [];
}

export function typeMap(s: Surface): Map<string, TypeDoc> {
	return new Map(s.types.map((t) => [t.name, t]));
}

/** `Promise<X>` read as `X` for a glance table; cut to fit. */
export function glanceReturn(type: string, max = 36): string {
	const inner = /^Promise<([\s\S]*)>$/.exec(type.trim())?.[1] ?? type;
	return shortType(inner.replace(/, any, any>/, ">"), max);
}

// ── REST twins ─────────────────────────────────────────────────────────

/**
 * A method's `rest` (`GET /v1/subgraphs/{name}/{table}{cursorQs}`) as the
 * endpoint it calls: trailing template holes that are not path segments
 * (`{options}`) drop away.
 */
export function restTarget(rest: string): { method: string; path: string } {
	const [method = "GET", ...path] = rest.split(" ");
	return {
		method,
		path: path.join(" ").replace(/([^/])\{[A-Za-z]+\}$/, "$1"),
	};
}

// ── errors ─────────────────────────────────────────────────────────────

export type ErrorLine = { prefix: string; name: string; note: string };

/** The error family as tree lines: the root (the parent no listed error extends past), then each class under its parent. */
export function errorTree(errors: Manifest["errors"]): ErrorLine[] {
	const names = new Set(errors.map((e) => e.name));
	const children = new Map<string, Manifest["errors"]>();
	for (const e of errors)
		children.set(e.parent, [...(children.get(e.parent) ?? []), e]);
	const roots = [...new Set(errors.map((e) => e.parent))].filter(
		(p) => !names.has(p),
	);
	const lines: ErrorLine[] = [];
	const walk = (parent: string, lead: string) => {
		const kids = children.get(parent) ?? [];
		kids.forEach((kid, i) => {
			const last = i === kids.length - 1;
			lines.push({
				prefix: `${lead}${last ? "└─ " : "├─ "}`,
				name: kid.name,
				note: kid.status ? String(kid.status) : "",
			});
			walk(kid.name, `${lead}${last ? "   " : "│  "}`);
		});
	};
	for (const root of roots) {
		lines.push({ prefix: "", name: root, note: "root of the family" });
		walk(root, "");
	}
	return lines;
}

const FEATURED_HELPERS = 11;
const FEATURED_SUMMARY_MAX = 60;

/** Helpers worth a box on the overview: the ones with a short one-line summary. */
export function shortHelpers(
	helpers: Manifest["helpers"],
): Manifest["helpers"] {
	return helpers
		.filter((h) => h.summary && h.summary.length <= FEATURED_SUMMARY_MAX)
		.slice(0, FEATURED_HELPERS);
}

// ── what the nav and the overview need ────────────────────────────────

/** Method paths and one-line summaries, for the docs search index. */
export function methodNav(): {
	slug: string;
	methods: { anchor: string; path: string; summary: string }[];
}[] {
	return manifest().surfaces.map((s) => ({
		slug: s.slug,
		methods: surface(s.slug).methods.map(({ id, path, summary }) => ({
			anchor: methodAnchor(id),
			path,
			summary,
		})),
	}));
}

const slugOf = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/**
 * Where an export of the old single-page reference lives now, keyed by the
 * `x-<slug>` anchor that page gave it, and the old `##` area anchors.
 */
export function legacyOwners(): Record<string, string> {
	const owners: Record<string, string> = {
		client: "/docs/sdk-reference/client",
		index: "/docs/sdk-reference/index",
		subgraphs: "/docs/sdk-reference/subgraphs",
		streams: "/docs/sdk-reference/streams",
		"subscriptions-and-webhooks": "/docs/sdk-reference/webhooks",
		contracts: "/docs/sdk-reference/contracts",
		errors: "/docs/sdk-reference/errors",
		proofs: "/docs/sdk-reference/helpers",
	};
	const m = manifest();
	for (const [name, href] of Object.entries(m.symbols))
		owners[`x-${slugOf(name)}`] ??= href;
	for (const h of m.helpers)
		owners[`x-${slugOf(h.name)}`] ??=
			`/docs/sdk-reference/helpers#${helperAnchor(h.name)}`;
	for (const e of m.errors)
		owners[`x-${slugOf(e.name)}`] ??=
			`/docs/sdk-reference/errors#${errorAnchor(e.name)}`;
	return owners;
}
