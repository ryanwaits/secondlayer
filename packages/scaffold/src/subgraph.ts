/**
 * Browser-safe subgraph scaffold generator — pure string templating, no deps.
 */

type AbiType = string | Record<string, unknown>;

interface AbiFunction {
	name: string;
	access: "public" | "read-only" | "private";
	args: ReadonlyArray<{ name: string; type: AbiType }>;
	outputs: AbiType;
}

interface AbiMap {
	name: string;
	key: AbiType;
	value: AbiType;
}

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

function toSnake(name: string): string {
	return name.replace(/-/g, "_");
}

function toCamel(name: string): string {
	return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

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

	const tableDefs: string[] = [];

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

	for (const fn of publicFunctions) {
		const tableName = toSnake(fn.name);
		const columns = buildColumns(fn.args);
		tableDefs.push(
			`    ${tableName}: {\n      columns: {\n${columns}\n      }\n    }`,
		);
	}

	const schemaBlock = tableDefs.join(",\n");

	// `defineSubgraph` expects `sources` keyed by handler name + `handlers`
	// keyed by the same name. Each event gets a `print_event` filter; each
	// public function gets a `contract_call` filter. The key is the table
	// name (snake-case), which is also what the handler inserts into.
	const sourceEntries: string[] = [];
	const handlerEntries: string[] = [];

	if (hasEvents) {
		for (const ev of events) {
			const tableName = toSnake(ev.name);
			sourceEntries.push(
				`    ${tableName}: { type: 'print_event', contractId: '${contractId}', topic: '${ev.name}' }`,
			);
			let insertCall: string;
			if (isAbiTuple(ev.value)) {
				insertCall = buildInsertCall(tableName, ev.value.tuple);
			} else {
				insertCall = `      ctx.insert('${tableName}', {\n        value: event.value,\n      });`;
			}
			handlerEntries.push(
				`    ${tableName}: async (event, ctx) => {\n${insertCall}\n    }`,
			);
		}
	}

	for (const fn of publicFunctions) {
		const tableName = toSnake(fn.name);
		sourceEntries.push(
			`    ${tableName}: { type: 'contract_call', contractId: '${contractId}', functionName: '${fn.name}' }`,
		);
		const insertCall = buildInsertCall(tableName, fn.args);
		handlerEntries.push(
			`    ${tableName}: async (event, ctx) => {\n${insertCall}\n    }`,
		);
	}

	const sourcesBlock = sourceEntries.join(",\n");
	const handlersBlock = handlerEntries.join(",\n\n");

	return `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: '${name}',
  sources: {
${sourcesBlock}
  },
  schema: {
${schemaBlock}
  },
  handlers: {
${handlersBlock}
  }
});
`;
}

export type { AbiFunction, AbiMap };
