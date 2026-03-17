import type { AbiFunction } from "@secondlayer/stacks/clarity";
import { formatCode } from "../utils/format.ts";
import { clarityTypeToSubgraphColumn } from "./clarity-to-subgraph.ts";

export interface SubgraphScaffoldInput {
  /** Full contract identifier, e.g. SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.contract-name */
  contractId: string;
  /** Public functions from the contract ABI */
  functions: readonly AbiFunction[];
  /** Subgraph name (defaults to contract name portion of contractId) */
  subgraphName?: string;
}

/**
 * Generates a `defineSubgraph()` TypeScript file from a contract ABI.
 *
 * Strategy: one table per public function, columns = function arguments
 * mapped via the Clarity type → ColumnType mapper.
 */
export async function generateSubgraphScaffold(input: SubgraphScaffoldInput): Promise<string> {
  const { contractId, functions } = input;

  // Derive subgraph name from contract portion if not provided
  const contractParts = contractId.split(".");
  const contractName = contractParts[contractParts.length - 1] ?? contractId;
  const subgraphName = input.subgraphName ?? contractName;

  // Public functions only (skip read-only and private)
  const publicFunctions = functions.filter((f) => f.access === "public");

  if (publicFunctions.length === 0) {
    throw new Error(`No public functions found in ${contractId}`);
  }

  // Build schema tables — one per public function
  const tables = publicFunctions.map((fn) => {
    const columns = fn.args
      .map((arg: { name: string; type: any }) => {
        const mapped = clarityTypeToSubgraphColumn(arg.type);
        const nullable = mapped.nullable ? ", nullable: true" : "";
        return `        ${arg.name.replace(/-/g, "_")}: { type: '${mapped.type}'${nullable} }`;
      })
      .join(",\n");

    const tableName = fn.name.replace(/-/g, "_");
    return `    ${tableName}: {\n      columns: {\n${columns || "        _placeholder: { type: 'text' }"}\n      }\n    }`;
  });

  const schemaBlock = tables.join(",\n");

  // Handler keys — one per function using full contract::function format
  const handlerKeys = publicFunctions.map((fn) => {
    return `    '${contractId}::${fn.name}': async (event, ctx) => {
      // TODO: implement ${fn.name} handler
      // event.args contains the function arguments
      // ctx.insert('${fn.name.replace(/-/g, "_")}', { ... })
    }`;
  });

  const handlersBlock = handlerKeys.join(",\n\n");

  const code = `
import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: '${subgraphName}',
  sources: [{ contract: '${contractId}' }],
  schema: {
${schemaBlock}
  },
  handlers: {
${handlersBlock}
  }
});
`.trimStart();

  return formatCode(code);
}
