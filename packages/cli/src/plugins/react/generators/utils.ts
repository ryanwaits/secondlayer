/**
 * Utility functions for React hook generation
 */

// Helper functions
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function generateHookArgsSignature(args: readonly any[]): string {
  if (args.length === 0) return "";

  const argsList = args
    .map((arg) => `${toCamelCase(arg.name)}: ${mapClarityTypeToTS(arg.type)}`)
    .join(", ");
  return `${argsList}`;
}

export function generateArgsType(args: readonly any[]): string {
  if (args.length === 0) return "void";

  const argsList = args
    .map((arg) => `${toCamelCase(arg.name)}: ${mapClarityTypeToTS(arg.type)}`)
    .join("; ");
  return `{ ${argsList} }`;
}

export function generateQueryKeyArgs(args: readonly any[]): string {
  if (args.length === 0) return "";
  return args.map((arg) => toCamelCase(arg.name)).join(", ");
}

export function generateFunctionCallArgs(args: readonly any[]): string {
  if (args.length === 0) return "";
  return args.map((arg) => toCamelCase(arg.name)).join(", ");
}

export function generateEnabledCondition(args: readonly any[]): string {
  return args
    .map((arg) => {
      const camelName = toCamelCase(arg.name);
      const type = mapClarityTypeToTS(arg.type);
      if (type === "string") return `!!${camelName}`;
      if (type === "bigint") return `${camelName} !== undefined`;
      return `${camelName} !== undefined`;
    })
    .join(" && ");
}

export function mapClarityTypeToTS(clarityType: any): string {
  // Handle non-string types
  if (typeof clarityType !== "string") {
    if (clarityType?.uint || clarityType?.int) return "bigint";
    if (clarityType?.principal) return "string";
    if (clarityType?.bool) return "boolean";
    if (clarityType?.string || clarityType?.ascii) return "string";
    if (clarityType?.buff) return "Uint8Array";
    if (clarityType?.optional) {
      const innerType = mapClarityTypeToTS(clarityType.optional);
      return `${innerType} | null`;
    }
    if (clarityType?.response) return "any";
    if (clarityType?.tuple) return "any";
    if (clarityType?.list) return "any[]";
    return "any";
  }

  // Handle string types
  if (clarityType.includes("uint") || clarityType.includes("int"))
    return "bigint";
  if (clarityType.includes("principal")) return "string";
  if (clarityType.includes("bool")) return "boolean";
  if (clarityType.includes("string") || clarityType.includes("ascii"))
    return "string";
  if (clarityType.includes("buff")) return "Uint8Array";
  if (clarityType.includes("optional")) {
    const innerType = clarityType.replace(/optional\s*/, "").trim();
    return `${mapClarityTypeToTS(innerType)} | null`;
  }
  if (clarityType.includes("response")) return "any"; // TODO: Better response type handling
  if (clarityType.includes("tuple")) return "any"; // TODO: Better tuple type handling
  if (clarityType.includes("list")) return "any[]"; // TODO: Better list type handling

  return "any";
}

export function generateObjectArgs(args: readonly any[]): string {
  if (args.length === 0) return "";
  return args.map((arg) => `${arg.name}: ${toCamelCase(arg.name)}`).join(", ");
}
