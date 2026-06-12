import {
	type ClarityValue,
	type TupleCV,
	deserializeCV,
} from "@secondlayer/stacks/clarity";
import type { ColumnType } from "./types.ts";

/**
 * Empirical print-payload schema inference. Callers (the index print-schema
 * endpoint) extract topic + raw Clarity hex per row; this module deserializes
 * a bounded sample per topic, unifies the observed value shapes into a single
 * structural tree, and renders Clarity/TS/ColumnType views of each field.
 */

export interface PrintSample {
	blockHeight: number;
	topic: string;
	rawHex: string | null;
}

export interface InferredPrintField {
	/** Original kebab-case tuple key (the `topic` discriminant is excluded) */
	name: string;
	/** What handlers see on `e.data` — exact runner camelization */
	camel_name: string;
	/** Rendered Clarity type; buff/string lengths are the max observed */
	clarity_type: string;
	/** Decoded handler value type (uint→bigint, buffer→string, …) */
	ts_type: string;
	column_type: ColumnType;
	/** Present in 100% of this topic's decoded samples */
	always_present: boolean;
	/** Only when optional observed: share of present samples that were some */
	optional_some_rate?: number;
}

export interface InferredTopicSchema {
	topic: string;
	count: number;
	first_height: number;
	last_height: number;
	non_tuple: boolean;
	fields: InferredPrintField[];
}

/**
 * Kebab-case → camelCase using the exact runner regex, so `camel_name`
 * matches what handlers see on `e.data` (runner.ts camelizeKeys).
 */
export function camelizeDataKey(str: string): string {
	return str.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Structural type tree. `null` inner = never observed (empty list, none-only
 * optional, one-sided response) and renders as "?".
 */
type Tree =
	| { kind: "uint" | "int" | "bool" | "principal" }
	| { kind: "buffer" | "ascii" | "utf8"; len: number }
	| { kind: "optional"; inner: Tree | null }
	| { kind: "list"; inner: Tree | null }
	| {
			kind: "tuple";
			count: number;
			entries: Map<string, { tree: Tree; present: number }>;
	  }
	| { kind: "response"; ok: Tree | null; err: Tree | null }
	| { kind: "union"; members: Tree[] };

function cvToTree(cv: ClarityValue): Tree {
	switch (cv.type) {
		case "uint":
		case "int":
			return { kind: cv.type };
		case "true":
		case "false":
			return { kind: "bool" };
		case "address":
		case "contract":
			return { kind: "principal" };
		case "buffer":
			return { kind: "buffer", len: cv.value.length / 2 };
		case "ascii":
			return { kind: "ascii", len: cv.value.length };
		case "utf8":
			// Clarity string-utf8 lengths are byte counts, not code points
			return { kind: "utf8", len: new TextEncoder().encode(cv.value).length };
		case "none":
			return { kind: "optional", inner: null };
		case "some":
			return { kind: "optional", inner: cvToTree(cv.value) };
		case "ok":
			return { kind: "response", ok: cvToTree(cv.value), err: null };
		case "err":
			return { kind: "response", ok: null, err: cvToTree(cv.value) };
		case "list": {
			let inner: Tree | null = null;
			for (const el of cv.value) {
				const t = cvToTree(el);
				inner = inner ? unify(inner, t) : t;
			}
			return { kind: "list", inner };
		}
		case "tuple": {
			const entries = new Map<string, { tree: Tree; present: number }>();
			for (const [k, v] of Object.entries(cv.value)) {
				entries.set(k, { tree: cvToTree(v), present: 1 });
			}
			return { kind: "tuple", count: 1, entries };
		}
	}
}

function unifyNullable(a: Tree | null, b: Tree | null): Tree | null {
	if (!a) return b;
	if (!b) return a;
	return unify(a, b);
}

/**
 * Canonical union-member order. Unions hold at most one member per kind
 * (same-kind members always merge), so sorting by kind makes the union —
 * and everything rendered from it — independent of sample order.
 */
const UNION_KIND_ORDER: Record<string, number> = {
	uint: 0,
	int: 1,
	bool: 2,
	principal: 3,
	buffer: 4,
	ascii: 5,
	utf8: 6,
	list: 7,
	tuple: 8,
	response: 9,
};

function makeUnion(members: Tree[]): Tree {
	const sorted = [...members].sort(
		(a, b) =>
			(UNION_KIND_ORDER[a.kind] ?? 99) - (UNION_KIND_ORDER[b.kind] ?? 99),
	);
	return { kind: "union", members: sorted };
}

function unify(a: Tree, b: Tree): Tree {
	// Optional hoists above unions/conflicts so unification is commutative and
	// associative: (optional T) ∪ U = (optional (T ∪ U)) regardless of which
	// sample order introduced the optional. Union members are never optional.
	if (a.kind === "optional" || b.kind === "optional") {
		const ai = a.kind === "optional" ? a.inner : a;
		const bi = b.kind === "optional" ? b.inner : b;
		return { kind: "optional", inner: unifyNullable(ai, bi) };
	}
	if (a.kind === "union") return unionAdd(a.members, b);
	if (b.kind === "union") return unionAdd(b.members, a);
	if (a.kind !== b.kind) return makeUnion([a, b]);
	switch (a.kind) {
		case "uint":
		case "int":
		case "bool":
		case "principal":
			return a;
		case "buffer":
		case "ascii":
		case "utf8":
			return { kind: a.kind, len: Math.max(a.len, (b as typeof a).len) };
		case "list":
			return {
				kind: "list",
				inner: unifyNullable(a.inner, (b as typeof a).inner),
			};
		case "response": {
			const rb = b as typeof a;
			return {
				kind: "response",
				ok: unifyNullable(a.ok, rb.ok),
				err: unifyNullable(a.err, rb.err),
			};
		}
		case "tuple": {
			const tb = b as typeof a;
			const entries = new Map(
				[...a.entries].map(
					([k, e]) =>
						[k, { ...e }] as [string, { tree: Tree; present: number }],
				),
			);
			for (const [k, e] of tb.entries) {
				const existing = entries.get(k);
				entries.set(
					k,
					existing
						? {
								tree: unify(existing.tree, e.tree),
								present: existing.present + e.present,
							}
						: { ...e },
				);
			}
			return { kind: "tuple", count: a.count + tb.count, entries };
		}
	}
}

/** Merge into an existing union: join a compatible member, else append. */
function unionAdd(members: Tree[], t: Tree): Tree {
	if (t.kind === "union") {
		let acc: Tree = { kind: "union", members };
		for (const m of t.members) acc = unify(acc, m);
		return acc;
	}
	const next = [...members];
	for (let i = 0; i < next.length; i++) {
		const member = next[i];
		if (!member) continue;
		const merged = unify(member, t);
		if (merged.kind !== "union") {
			next[i] = merged;
			return makeUnion(next);
		}
	}
	next.push(t);
	return makeUnion(next);
}

function wrapOptional(t: Tree): Tree {
	return t.kind === "optional" ? t : { kind: "optional", inner: t };
}

function renderClarity(t: Tree | null): string {
	if (!t) return "?";
	switch (t.kind) {
		case "uint":
		case "int":
		case "bool":
		case "principal":
			return t.kind;
		case "buffer":
			return `(buff ${t.len})`;
		case "ascii":
			return `(string-ascii ${t.len})`;
		case "utf8":
			return `(string-utf8 ${t.len})`;
		case "optional":
			return `(optional ${renderClarity(t.inner)})`;
		case "list":
			return `(list ${renderClarity(t.inner)})`;
		case "response":
			return `(response ${renderClarity(t.ok)} ${renderClarity(t.err)})`;
		case "tuple": {
			const parts = [...t.entries].map(([k, e]) => {
				const tree = e.present < t.count ? wrapOptional(e.tree) : e.tree;
				return `(${k} ${renderClarity(tree)})`;
			});
			return `(tuple ${parts.join(" ")})`;
		}
		case "union":
			return t.members.map(renderClarity).join(" | ");
	}
}

function renderTs(t: Tree | null): string {
	if (!t) return "unknown";
	switch (t.kind) {
		case "uint":
		case "int":
			return "bigint";
		case "bool":
			return "boolean";
		case "principal":
		case "buffer":
		case "ascii":
		case "utf8":
			return "string";
		case "optional":
			return t.inner ? `${renderTs(t.inner)} | null` : "unknown | null";
		case "list": {
			const inner = renderTs(t.inner);
			return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
		}
		case "response": {
			// Runtime unwraps both sides → handler sees the union of inner types
			const sides = [...new Set([renderTs(t.ok), renderTs(t.err)])];
			return sides.join(" | ");
		}
		case "tuple": {
			const parts = [...t.entries].map(([k, e]) => {
				const opt = e.present < t.count ? "?" : "";
				return `${camelizeDataKey(k)}${opt}: ${renderTs(e.tree)}`;
			});
			return `{ ${parts.join("; ")} }`;
		}
		case "union":
			return [...new Set(t.members.map((m) => renderTs(m)))].join(" | ");
	}
}

function toColumnType(t: Tree | null): ColumnType {
	if (!t) return "jsonb";
	switch (t.kind) {
		case "uint":
			return "uint";
		case "int":
			return "int";
		case "bool":
			return "boolean";
		case "principal":
			return "principal";
		case "buffer":
		case "ascii":
		case "utf8":
			return "text";
		case "list":
		case "tuple":
			return "jsonb";
		// Nullability is carried by always_present/optional_some_rate, not the column type
		case "optional":
			return toColumnType(t.inner);
		case "response":
			return t.ok ? toColumnType(t.ok) : "jsonb";
		case "union":
			return "jsonb";
	}
}

/** Per-topic deserialization budget: spread across the newest + oldest rows that have raw hex */
const MAX_DECODED_PER_TOPIC_NEWEST = 75;
const MAX_DECODED_PER_TOPIC_OLDEST = 25;

/**
 * Infers per-topic field schemas from sampled print events. Counts and
 * height bounds cover ALL rows of a topic (cheap); only a bounded subset is
 * deserialized for typing. Rows with missing/undecodable hex still count but
 * contribute nothing to typing.
 */
export function inferPrintTopics(
	samples: PrintSample[],
): InferredTopicSchema[] {
	const groups = new Map<string, PrintSample[]>();
	for (const s of samples) {
		const group = groups.get(s.topic);
		if (group) group.push(s);
		else groups.set(s.topic, [s]);
	}

	const out: InferredTopicSchema[] = [];
	for (const [topic, rows] of groups) {
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		for (const r of rows) {
			if (r.blockHeight < first) first = r.blockHeight;
			if (r.blockHeight > last) last = r.blockHeight;
		}

		// Spend the decode budget only on rows that have raw hex, so null-hex
		// rows (still counted in totals/heights) don't starve typing.
		const withHex = [...rows]
			.filter((r): r is PrintSample & { rawHex: string } => r.rawHex !== null)
			.sort((a, b) => b.blockHeight - a.blockHeight);
		const budget = MAX_DECODED_PER_TOPIC_NEWEST + MAX_DECODED_PER_TOPIC_OLDEST;
		const picked =
			withHex.length <= budget
				? withHex
				: [
						...withHex.slice(0, MAX_DECODED_PER_TOPIC_NEWEST),
						...withHex.slice(-MAX_DECODED_PER_TOPIC_OLDEST),
					];

		const tuples: TupleCV[] = [];
		let decoded = 0;
		for (const p of picked) {
			try {
				const cv = deserializeCV(p.rawHex);
				decoded++;
				if (cv.type === "tuple") tuples.push(cv);
			} catch {
				// undecodable hex contributes nothing to typing
			}
		}

		// Only claim non_tuple when something actually decoded to a non-tuple;
		// zero decoded samples is "no evidence", not a non-tuple payload.
		const nonTuple = decoded > 0 && tuples.length === 0;
		const fields: InferredPrintField[] = [];
		if (!nonTuple) {
			const stats = new Map<
				string,
				{
					tree: Tree;
					present: number;
					noneCount: number;
					optionalSeen: boolean;
				}
			>();
			for (const t of tuples) {
				for (const [key, value] of Object.entries(t.value)) {
					// `topic` is the discriminant, never payload data (runner strips it)
					if (key === "topic") continue;
					const tree = cvToTree(value);
					const existing = stats.get(key);
					if (existing) {
						existing.present++;
						existing.tree = unify(existing.tree, tree);
						if (value.type === "none") existing.noneCount++;
						if (value.type === "none" || value.type === "some") {
							existing.optionalSeen = true;
						}
					} else {
						stats.set(key, {
							tree,
							present: 1,
							noneCount: value.type === "none" ? 1 : 0,
							optionalSeen: value.type === "none" || value.type === "some",
						});
					}
				}
			}
			for (const [name, st] of [...stats].sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				const field: InferredPrintField = {
					name,
					camel_name: camelizeDataKey(name),
					clarity_type: renderClarity(st.tree),
					ts_type: renderTs(st.tree),
					column_type: toColumnType(st.tree),
					always_present: st.present === tuples.length,
				};
				if (st.optionalSeen) {
					field.optional_some_rate = (st.present - st.noneCount) / st.present;
				}
				fields.push(field);
			}
		}

		out.push({
			topic,
			count: rows.length,
			first_height: first,
			last_height: last,
			non_tuple: nonTuple,
			fields,
		});
	}

	return out.sort((a, b) => b.count - a.count);
}
