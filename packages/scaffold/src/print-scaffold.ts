/**
 * Print-schema subgraph scaffold — emits a deploy-ready `defineSubgraph()`
 * from a contract's empirically inferred print topics (the
 * /v1/index/contracts/:id/print-schema response). Pure string templating:
 * callers (CLI `sl subgraphs create --from-contract`) fetch the schema and
 * pass the topics in.
 *
 * Topics and field names are chain-derived (arbitrary strings), so every
 * interpolation into the emitted code is escaped, non-identifier object keys
 * are quoted, and name collisions (camelized source keys, table names,
 * snake-cased columns) are deterministically suffixed.
 */

/** One inferred field of a topic — structural subset of the print-schema response. */
export interface PrintScaffoldField {
	/** Original kebab-case tuple key. */
	name: string;
	/** What handlers see on `event.data`. */
	camel_name: string;
	/** Subgraph ColumnType vocab (conflicts arrive as "jsonb"). */
	column_type: string;
	/** Present in 100% of the topic's samples. */
	always_present: boolean;
}

/** One inferred topic — structural subset of the print-schema response. */
export interface PrintScaffoldTopic {
	/** Tuple `topic` field; "*" pseudo-topic for absent/non-tuple prints. */
	topic: string;
	non_tuple?: boolean;
	fields: PrintScaffoldField[];
}

export interface PrintScaffoldInput {
	/** Full contract identifier, e.g. SP….contract-name. */
	contractId: string;
	/** Subgraph name (defaults to the contract name). */
	name?: string;
	/** Inferred topics from the print-schema endpoint. */
	topics: PrintScaffoldTopic[];
	/** One table per topic instead of a single wide table. */
	tablePerTopic?: boolean;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Escaped body for a single-quoted JS literal or line comment. JSON.stringify
 * handles backslashes, control chars, and newlines; we then swap its
 * double-quote escaping for single-quote, and escape U+2028/U+2029 (legal in
 * JSON output but line terminators inside a `//` comment).
 */
function escapeJs(s: string): string {
	return JSON.stringify(s)
		.slice(1, -1)
		.replace(/\\"/g, '"')
		.replace(/'/g, "\\'")
		.replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

/** Single-quoted JS string literal with chain-derived content escaped. */
function str(s: string): string {
	return `'${escapeJs(s)}'`;
}

/** Object-literal key — quoted+escaped when not a valid identifier (kebab topics). */
function key(k: string): string {
	return IDENT_RE.test(k) ? k : str(k);
}

/** `event.data.<field>` access — bracket form for non-identifier keys. */
function dataAccess(camel: string): string {
	return IDENT_RE.test(camel)
		? `event.data.${camel}`
		: `event.data[${str(camel)}]`;
}

/** Kebab-case → camelCase, matching the runtime's `event.data` key camelization. */
function toCamelCase(str: string): string {
	return str.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(str: string): string {
	return str.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

/** Sanitized SQL-safe table name from a contract or topic name. */
function tableName(str: string): string {
	const cleaned = str
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return cleaned || "events";
}

/**
 * Deterministic collision dedupe: first claimant keeps the base name, later
 * ones get `_2`, `_3`, … in input order. `reserved` names are never handed out.
 */
function makeDeduper(reserved: string[] = []): (base: string) => string {
	const used = new Set(reserved);
	return (base) => {
		let candidate = base;
		for (let i = 2; used.has(candidate); i++) candidate = `${base}_${i}`;
		used.add(candidate);
		return candidate;
	};
}

function wrap(
	name: string,
	sources: string,
	schema: string,
	handlers: string,
): string {
	return `
import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: ${str(name)},
  sources: {
${sources}
  },
  schema: {
${schema}
  },
  handlers: {
${handlers}
  }
});
`.trimStart();
}

/** Source entry: pinned print_event + per-topic `prints` map for typed `event.data`. */
function sourceEntry(
	srcKey: string,
	contractId: string,
	topic: PrintScaffoldTopic,
): string {
	const lines = [
		"      type: 'print_event',",
		`      contractId: ${str(contractId)},`,
		`      topic: ${str(topic.topic)}`,
	];
	if (topic.fields.length > 0) {
		// prints keys must match runtime event.data keys, so duplicates can't be
		// suffixed — keep the first occurrence of a camel_name.
		const seen = new Set<string>();
		const fieldLines: string[] = [];
		for (const f of topic.fields) {
			if (seen.has(f.camel_name)) continue;
			seen.add(f.camel_name);
			fieldLines.push(`          ${key(f.camel_name)}: ${str(f.column_type)}`);
		}
		lines[lines.length - 1] += ",";
		lines.push(
			`      prints: {\n        ${key(topic.topic)}: {\n${fieldLines.join(",\n")}\n        }\n      }`,
		);
	}
	return `    ${key(srcKey)}: {\n${lines.join("\n")}\n    }`;
}

/** Wildcard-only contract (non-tuple prints): one generic source + jsonb table. */
function wildcardScaffold(
	name: string,
	contractId: string,
	table: string,
): string {
	return wrap(
		name,
		`    events: { type: 'print_event', contractId: ${str(contractId)} }`,
		`    ${key(table)}: {
      columns: {
        topic: { type: 'text', indexed: true, nullable: true },
        value: { type: 'jsonb', nullable: true }
      }
    }`,
		`    events: (event, ctx) => {
      ctx.insert(${str(table)}, { topic: event.topic ?? null, value: event.data ?? null });
    }`,
	);
}

interface WideColumn {
	snake: string;
	camel: string;
	columnTypes: Set<string>;
	/** Topics this field appears on (in topic order). */
	topics: string[];
	alwaysPresentEverywhere: boolean;
}

export function generatePrintSchemaSubgraph(input: PrintScaffoldInput): string {
	const contractName = input.contractId.split(".").pop() ?? input.contractId;
	const name = input.name ?? contractName;

	// "*" is the absent/non-tuple pseudo-topic — only scaffold it when it's all
	// the contract emits (a named-topic source would never match those events).
	const named = input.topics.filter((t) => t.topic !== "*");
	const topics = named.length > 0 ? named : input.topics;
	if (topics.length === 0) {
		throw new Error("print scaffold requires at least one topic");
	}

	const wideTable = tableName(contractName);
	if (topics.length === 1 && topics[0]?.topic === "*") {
		return wildcardScaffold(name, input.contractId, wideTable);
	}

	// Distinct topics can camelize to the same source key — suffix later ones
	// so sources/handlers don't silently overwrite each other.
	const dedupeSourceKey = makeDeduper();
	const sourceKeyByTopic = new Map<string, string>();
	for (const t of topics) {
		sourceKeyByTopic.set(t.topic, dedupeSourceKey(toCamelCase(t.topic)));
	}
	const srcKey = (t: PrintScaffoldTopic): string =>
		sourceKeyByTopic.get(t.topic) as string;

	const sources = topics
		.map((t) => sourceEntry(srcKey(t), input.contractId, t))
		.join(",\n");

	if (input.tablePerTopic) {
		// Resolve table + column names once so schema and handlers agree on
		// collision suffixes.
		const dedupeTable = makeDeduper();
		const perTopic = topics.map((t) => {
			const table = dedupeTable(tableName(t.topic));
			const dedupeCol = makeDeduper();
			const snakeFor = new Map<string, string>();
			for (const f of t.fields) {
				if (!snakeFor.has(f.camel_name)) {
					snakeFor.set(f.camel_name, dedupeCol(camelToSnake(f.camel_name)));
				}
			}
			return { topic: t, table, snakeFor };
		});

		const schema = perTopic
			.map(({ topic: t, table, snakeFor }) => {
				const cols =
					t.fields.length > 0
						? [...snakeFor.entries()]
								.map(([camel, snake]) => {
									const f = t.fields.find((f) => f.camel_name === camel);
									return `        ${key(snake)}: { type: ${str(f?.column_type ?? "jsonb")}${f?.always_present ? "" : ", nullable: true"} }`;
								})
								.join(",\n")
						: `        value: { type: 'jsonb', nullable: true }`;
				return `    ${key(table)}: {\n      columns: {\n${cols}\n      }\n    }`;
			})
			.join(",\n");
		const handlers = perTopic
			.map(({ topic: t, table, snakeFor }) => {
				const row =
					t.fields.length > 0
						? [...snakeFor.entries()]
								.map(([camel, snake]) => `${key(snake)}: ${dataAccess(camel)}`)
								.join(", ")
						: "value: event.data ?? null";
				return `    ${key(srcKey(t))}: (event, ctx) => {\n      ctx.insert(${str(table)}, { ${row} });\n    }`;
			})
			.join(",\n\n");
		return wrap(name, sources, schema, handlers);
	}

	// Default: single wide table — union of every topic's columns + a `topic`
	// discriminant, nullable unless the field is always present on every topic.
	const columns = new Map<string, WideColumn>();
	for (const t of topics) {
		for (const f of t.fields) {
			let col = columns.get(f.camel_name);
			if (!col) {
				col = {
					snake: "",
					camel: f.camel_name,
					columnTypes: new Set(),
					topics: [],
					alwaysPresentEverywhere: true,
				};
				columns.set(f.camel_name, col);
			}
			col.columnTypes.add(f.column_type);
			if (!col.topics.includes(t.topic)) col.topics.push(t.topic);
			if (!f.always_present) col.alwaysPresentEverywhere = false;
		}
	}
	// Union semantics stay keyed by camel_name; only DIFFERENT fields whose
	// snake names collide (or shadow the `topic` discriminant) get suffixed.
	const dedupeSnake = makeDeduper(["topic"]);
	for (const col of columns.values()) {
		col.snake = dedupeSnake(camelToSnake(col.camel));
	}

	const cols = [...columns.values()];
	const colLines = [
		`        topic: { type: 'text', indexed: true }${cols.length > 0 ? "," : ""}`,
		...cols.map((c, i) => {
			const universal = c.topics.length === topics.length;
			// Cross-topic type conflicts can't share a typed column — store as jsonb.
			const type = c.columnTypes.size === 1 ? [...c.columnTypes][0] : "jsonb";
			const nullable = !(universal && c.alwaysPresentEverywhere);
			const comma = i < cols.length - 1 ? "," : "";
			const comment = universal
				? ""
				: ` // null except on topics: ${c.topics.map(escapeJs).join(", ")}`;
			return `        ${key(c.snake)}: { type: ${str(type ?? "jsonb")}${nullable ? ", nullable: true" : ""} }${comma}${comment}`;
		}),
	].join("\n");
	const schema = `    ${key(wideTable)}: {\n      columns: {\n${colLines}\n      }\n    }`;

	const handlers = topics
		.map((t) => {
			const seen = new Set<string>();
			const fieldParts: string[] = [];
			for (const f of t.fields) {
				if (seen.has(f.camel_name)) continue;
				seen.add(f.camel_name);
				const snake = columns.get(f.camel_name)?.snake ?? f.camel_name;
				fieldParts.push(`${key(snake)}: ${dataAccess(f.camel_name)}`);
			}
			const fields = fieldParts.join(", ");
			const row = `{ topic: ${str(t.topic)}${fields ? `, ${fields}` : ""} }`;
			return `    ${key(srcKey(t))}: (event, ctx) => {\n      ctx.insert(${str(wideTable)}, ${row});\n    }`;
		})
		.join(",\n\n");

	return wrap(name, sources, schema, handlers);
}
