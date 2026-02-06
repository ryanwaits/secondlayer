/**
 * Shared utilities for plugin code generators (actions, testing).
 */

import { toCamelCase, type FunctionArg } from "@secondlayer/stacks/clarity";
import { getTypeForArg } from "./type-mapping";
import { generateClarityConversion } from "./clarity-conversion";

/**
 * Generate a TypeScript args signature for a helper function.
 * e.g. `args: { amount: bigint; recipient: string }, `
 */
export function generateArgsSignature(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "";

  const argsTypes = args
    .map((arg) => {
      const camelName = toCamelCase(arg.name);
      return `${camelName}: ${getTypeForArg(arg)}`;
    })
    .join("; ");

  return `args: { ${argsTypes} }, `;
}

/**
 * Generate Clarity argument expressions for function calls.
 * e.g. `Cl.uint(args.amount), Cl.standardPrincipal(args.recipient)`
 */
export function generateClarityArgs(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "";

  return args
    .map((arg) => {
      const argName = `args.${toCamelCase(arg.name)}`;
      return generateClarityConversion(argName, arg);
    })
    .join(", ");
}
