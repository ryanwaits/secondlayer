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

/** Subset of ColumnType — inlined to avoid depending on @secondlayer/subgraphs */
type ColumnType = "uint" | "int" | "principal" | "boolean" | "text" | "jsonb" | "serial";

interface MappedColumn {
  type: ColumnType;
  nullable: boolean;
}

// Inlined guard functions (from @secondlayer/stacks/clarity/abi/guards.ts)
function isAbiBuffer(t: AbiType): t is { buff: { length: number } } {
  return typeof t === "object" && t !== null && "buff" in t;
}
function isAbiStringAscii(t: AbiType): t is { "string-ascii": { length: number } } {
  return typeof t === "object" && t !== null && "string-ascii" in t;
}
function isAbiStringUtf8(t: AbiType): t is { "string-utf8": { length: number } } {
  return typeof t === "object" && t !== null && "string-utf8" in t;
}
function isAbiOptional(t: AbiType): t is { optional: AbiType } {
  return typeof t === "object" && t !== null && "optional" in t;
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
  if (isAbiOptional(abiType)) return mapType((abiType as { optional: AbiType }).optional, true);

  return { type: "jsonb", nullable };
}

function clarityTypeToSubgraphColumn(abiType: AbiType): MappedColumn {
  return mapType(abiType, false);
}

/**
 * Generates a `defineSubgraph()` TypeScript scaffold from selected contract functions.
 * Browser-safe — pure string templating, no formatCode dependency.
 */
export function generateSubgraphCode(
  contractId: string,
  functions: readonly AbiFunction[],
  subgraphName?: string,
): string {
  const contractParts = contractId.split(".");
  const contractName = contractParts[contractParts.length - 1] ?? contractId;
  const name = subgraphName ?? contractName;

  const publicFunctions = functions.filter((f) => f.access === "public");

  if (publicFunctions.length === 0) {
    return `// No public functions selected for ${contractId}`;
  }

  const tables = publicFunctions.map((fn) => {
    const columns = fn.args
      .map((arg) => {
        const mapped = clarityTypeToSubgraphColumn(arg.type);
        const nullable = mapped.nullable ? ", nullable: true" : "";
        return `        ${arg.name.replace(/-/g, "_")}: { type: '${mapped.type}'${nullable} }`;
      })
      .join(",\n");

    const tableName = fn.name.replace(/-/g, "_");
    return `    ${tableName}: {\n      columns: {\n${columns || "        _placeholder: { type: 'text' }"}\n      }\n    }`;
  });

  const schemaBlock = tables.join(",\n");

  const handlerKeys = publicFunctions.map((fn) => {
    return `    '${contractId}::${fn.name}': async (event, ctx) => {
      // TODO: implement ${fn.name} handler
      // event.args contains the function arguments
      // ctx.insert('${fn.name.replace(/-/g, "_")}', { ... })
    }`;
  });

  const handlersBlock = handlerKeys.join(",\n\n");

  return `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: '${name}',
  sources: [{ contract: '${contractId}' }],
  schema: {
${schemaBlock}
  },
  handlers: {
${handlersBlock}
  }
});
`;
}

// Re-export the AbiFunction type for consumers
export type { AbiFunction };
