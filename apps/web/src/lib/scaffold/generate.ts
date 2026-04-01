/**
 * Client-side subgraph scaffold generator.
 *
 * Inlines ABI type guards to avoid importing @secondlayer/stacks/clarity
 * (which pulls in node:module transitively and breaks the browser build).
 */

/** ABI type — simplified local definition matching @secondlayer/stacks/clarity */
type AbiType = string | Record<string, unknown>;

interface AbiFunction {
	name: string;
	access: "public" | "read-only" | "private";
	args: ReadonlyArray<{ name: string; type: AbiType }>;
	outputs: AbiType;
}

/** Minimal print_event map from ABI */
interface AbiMap {
	name: string;
	key: AbiType;
	value: AbiType;
}

/** Subset of ColumnType — inlined to avoid depending on @secondlayer/subgraphs */
type ColumnType =
	| "uint"
	| "int"
	| "principal"
	| "boolean"
	| "text"
	| "jsonb"
	| "serial";

interface MappedColumn {
	type: ColumnType;
	nullable: boolean;
}

// Inlined guard functions (from @secondlayer/stacks/clarity/abi/guards.ts)
function isAbiBuffer(t: AbiType): t is { buff: { length: number } } {
	return typeof t === "object" && t !== null && "buff" in t;
}
function isAbiStringAscii(
	t: AbiType,
): t is { "string-ascii": { length: number } } {
	return typeof t === "object" && t !== null && "string-ascii" in t;
}
function isAbiStringUtf8(
	t: AbiType,
): t is { "string-utf8": { length: number } } {
	return typeof t === "object" && t !== null && "string-utf8" in t;
}
function isAbiOptional(t: AbiType): t is { optional: AbiType } {
	return typeof t === "object" && t !== null && "optional" in t;
}
function isAbiTuple(
	t: AbiType,
): t is { tuple: ReadonlyArray<{ name: string; type: AbiType }> } {
	return typeof t === "object" && t !== null && "tuple" in t;
}
function isAbiList(
	t: AbiType,
): t is { list: { type: AbiType; length: number } } {
	return typeof t === "object" && t !== null && "list" in t;
}
function isAbiResponse(
	t: AbiType,
): t is { response: { ok: AbiType; error: AbiType } } {
	return typeof t === "object" && t !== null && "response" in t;
}

function mapType(abiType: AbiType, nullable: boolean): MappedColumn {
	if (typeof abiType === "string") {
		switch (abiType) {
			case "uint128":
				return { type: "uint", nullable };
			case "int128":
				return { type: "int", nullable };
			case "principal":
			case "trait_reference":
				return { type: "principal", nullable };
			case "bool":
				return { type: "boolean", nullable };
			default: {
				const s = abiType;
				if (s.includes("uint")) return { type: "uint", nullable };
				if (s.includes("int")) return { type: "int", nullable };
				if (s.includes("string") || s.includes("ascii") || s.includes("utf8")) {
					return { type: "text", nullable };
				}
				if (s.includes("buff")) return { type: "text", nullable };
				return { type: "jsonb", nullable };
			}
		}
	}

	if (isAbiBuffer(abiType)) return { type: "text", nullable };
	if (isAbiStringAscii(abiType) || isAbiStringUtf8(abiType)) {
		return { type: "text", nullable };
	}
	if (isAbiOptional(abiType))
		return mapType((abiType as { optional: AbiType }).optional, true);
	if (isAbiList(abiType) || isAbiTuple(abiType))
		return { type: "jsonb", nullable };
	if (isAbiResponse(abiType)) {
		return mapType(
			(abiType as { response: { ok: AbiType } }).response.ok,
			nullable,
		);
	}

	return { type: "jsonb", nullable };
}

function clarityTypeToSubgraphColumn(abiType: AbiType): MappedColumn {
	return mapType(abiType, false);
}

/** Convert kebab-case to snake_case */
function toSnake(name: string): string {
	return name.replace(/-/g, "_");
}

/** Convert kebab-case to camelCase (how event fields arrive at runtime) */
function toCamel(name: string): string {
	return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Build column definitions for a table */
function buildColumns(
	args: ReadonlyArray<{ name: string; type: AbiType }>,
): string {
	if (args.length === 0) return "        _placeholder: { type: 'text' }";
	return args
		.map((arg) => {
			const mapped = clarityTypeToSubgraphColumn(arg.type);
			const nullable = mapped.nullable ? ", nullable: true" : "";
			return `        ${toSnake(arg.name)}: { type: '${mapped.type}'${nullable} }`;
		})
		.join(",\n");
}

/** Build a ctx.insert() call with field mappings from event args */
function buildInsertCall(
	tableName: string,
	args: ReadonlyArray<{ name: string; type: AbiType }>,
): string {
	if (args.length === 0) {
		return `      ctx.insert('${tableName}', {\n        sender: ctx.tx.sender,\n      });`;
	}

	const mappings = args.map((arg) => {
		return `        ${toSnake(arg.name)}: event.${toCamel(arg.name)}`;
	});

	return `      ctx.insert('${tableName}', {\n${mappings.join(",\n")},\n      });`;
}

/**
 * Generates a `defineSubgraph()` TypeScript scaffold from selected contract functions.
 * Browser-safe — pure string templating, no formatCode dependency.
 */
export function generateSubgraphCode(
	contractId: string,
	functions: readonly AbiFunction[],
	subgraphName?: string,
	events?: readonly AbiMap[],
): string {
	const contractParts = contractId.split(".");
	const contractName = contractParts[contractParts.length - 1] ?? contractId;
	const name = subgraphName ?? contractName;

	const publicFunctions = functions.filter((f) => f.access === "public");
	const hasEvents = events && events.length > 0;

	if (publicFunctions.length === 0 && !hasEvents) {
		return `// No public functions or events selected for ${contractId}`;
	}

	// Build schema tables
	const tableDefs: string[] = [];

	// Tables from events
	if (hasEvents) {
		for (const ev of events) {
			const tableName = toSnake(ev.name);
			let columns: string;
			if (isAbiTuple(ev.value)) {
				columns = buildColumns(ev.value.tuple);
			} else {
				columns = `        value: { type: '${clarityTypeToSubgraphColumn(ev.value).type}' }`;
			}
			tableDefs.push(
				`    ${tableName}: {\n      columns: {\n${columns}\n      }\n    }`,
			);
		}
	}

	// Tables from public functions
	for (const fn of publicFunctions) {
		const tableName = toSnake(fn.name);
		const columns = buildColumns(fn.args);
		tableDefs.push(
			`    ${tableName}: {\n      columns: {\n${columns}\n      }\n    }`,
		);
	}

	const schemaBlock = tableDefs.join(",\n");

	// Build sources
	const sourceEntries: string[] = [`{ contract: '${contractId}' }`];

	// Build handlers
	const handlerEntries: string[] = [];

	// Event handlers
	if (hasEvents) {
		for (const ev of events) {
			const tableName = toSnake(ev.name);
			let insertCall: string;
			if (isAbiTuple(ev.value)) {
				insertCall = buildInsertCall(tableName, ev.value.tuple);
			} else {
				insertCall = `      ctx.insert('${tableName}', {\n        value: event.value,\n      });`;
			}
			handlerEntries.push(
				`    '${contractId}::${ev.name}': async (event, ctx) => {\n${insertCall}\n    }`,
			);
		}
	}

	// Function handlers
	for (const fn of publicFunctions) {
		const tableName = toSnake(fn.name);
		const insertCall = buildInsertCall(tableName, fn.args);
		handlerEntries.push(
			`    '${contractId}::${fn.name}': async (event, ctx) => {\n${insertCall}\n    }`,
		);
	}

	const handlersBlock = handlerEntries.join(",\n\n");

	return `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: '${name}',
  sources: [${sourceEntries.join(", ")}],
  schema: {
${schemaBlock}
  },
  handlers: {
${handlersBlock}
  }
});
`;
}

// Re-export types for consumers
export type { AbiFunction, AbiMap };
