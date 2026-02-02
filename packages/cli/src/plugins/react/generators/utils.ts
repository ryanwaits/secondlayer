/**
 * Utility functions for React hook generation
 */

import { toCamelCase, type FunctionArg } from "@secondlayer/clarity-types";
import { clarityTypeToTS } from "../../../utils/type-mapping";

// Re-export for use in other files
export { toCamelCase, clarityTypeToTS };

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function generateHookArgsSignature(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "";

  const argsList = args
    .map((arg) => `${toCamelCase(arg.name)}: ${clarityTypeToTS(arg.type)}`)
    .join(", ");
  return `${argsList}`;
}

export function generateArgsType(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "void";

  const argsList = args
    .map((arg) => `${toCamelCase(arg.name)}: ${clarityTypeToTS(arg.type)}`)
    .join("; ");
  return `{ ${argsList} }`;
}

export function generateArgNames(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "";
  return args.map((arg) => toCamelCase(arg.name)).join(", ");
}

export function generateEnabledCondition(args: ReadonlyArray<FunctionArg>): string {
  return args
    .map((arg) => {
      const camelName = toCamelCase(arg.name);
      const type = clarityTypeToTS(arg.type);
      if (type === "string") return `!!${camelName}`;
      if (type === "bigint") return `${camelName} !== undefined`;
      return `${camelName} !== undefined`;
    })
    .join(" && ");
}

export function generateObjectArgs(args: ReadonlyArray<FunctionArg>): string {
  if (args.length === 0) return "";
  return args.map((arg) => `${arg.name}: ${toCamelCase(arg.name)}`).join(", ");
}
