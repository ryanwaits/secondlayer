/**
 * Generate Markdown documentation from ClarityDoc
 */

import type { ClarityContract } from "@secondlayer/clarity-types";
import type { ContractDoc, FunctionDoc, MapDoc, VariableDoc } from "../types/doc-block";

/** Options for markdown generation */
export interface MarkdownOptions {
  /** Include private functions */
  includePrivate?: boolean;
  /** Include table of contents */
  includeToc?: boolean;
  /** Contract name for the title */
  contractName?: string;
  /** Include ABI type information */
  includeTypes?: boolean;
}

/** Generate Markdown documentation */
export function generateMarkdown(doc: ContractDoc, abi?: ClarityContract, options: MarkdownOptions = {}): string {
  const lines: string[] = [];
  const { includePrivate = false, includeToc = true, contractName, includeTypes = true } = options;

  // Title
  const title = doc.header.contract || contractName || "Contract Documentation";
  lines.push(`# ${title}`);
  lines.push("");

  // Contract header
  if (doc.header.desc) {
    lines.push(doc.header.desc);
    lines.push("");
  }

  if (doc.header.author) {
    lines.push(`**Author:** ${doc.header.author}`);
    lines.push("");
  }

  if (doc.header.dev) {
    lines.push(`> ${doc.header.dev}`);
    lines.push("");
  }

  if (doc.header.deprecated) {
    lines.push(`> **Deprecated:** ${doc.header.deprecated}`);
    lines.push("");
  }

  if (doc.header.implements.length > 0) {
    lines.push("**Implements:**");
    for (const impl of doc.header.implements) {
      lines.push(`- \`${impl}\``);
    }
    lines.push("");
  }

  // Documentation link
  if (doc.header.uri) {
    const hashNote = doc.header.docsHash ? ` (hash: \`${doc.header.docsHash}\`)` : "";
    lines.push(`**Documentation:** [${doc.header.uri}](${doc.header.uri})${hashNote}`);
    lines.push("");
  }

  // Separate error constants from regular constants
  const errorConstants = Array.from(doc.constants.values()).filter((c) => c.isError);
  const regularConstants = Array.from(doc.constants.values()).filter((c) => !c.isError);

  // Table of contents
  if (includeToc) {
    lines.push("## Table of Contents");
    lines.push("");
    if (doc.functions.size > 0) lines.push("- [Functions](#functions)");
    if (doc.maps.size > 0) lines.push("- [Maps](#maps)");
    if (errorConstants.length > 0) lines.push("- [Error Constants](#error-constants)");
    if (doc.variables.size > 0 || regularConstants.length > 0) lines.push("- [Variables](#variables)");
    lines.push("");
  }

  // Functions
  const functions = Array.from(doc.functions.values()).filter(
    (f) => includePrivate || f.access !== "private"
  );

  if (functions.length > 0) {
    lines.push("## Functions");
    lines.push("");

    for (const func of functions) {
      lines.push(...generateFunctionMarkdown(func, abi?.functions.find((f) => f.name === func.functionName), includeTypes));
      lines.push("");
    }
  }

  // Maps
  if (doc.maps.size > 0) {
    lines.push("## Maps");
    lines.push("");

    for (const map of doc.maps.values()) {
      lines.push(...generateMapMarkdown(map, abi?.maps?.find((m) => m.name === map.mapName), includeTypes));
      lines.push("");
    }
  }

  // Error Constants (separate section for wallet/explorer integration)
  if (errorConstants.length > 0) {
    lines.push("## Error Constants");
    lines.push("");
    lines.push("| Code | Name | Description |");
    lines.push("|------|------|-------------|");

    for (const errConst of errorConstants) {
      const code = errConst.errorCode ? `\`${errConst.errorCode}\`` : "-";
      lines.push(`| ${code} | \`${errConst.variableName}\` | ${errConst.errorDescription || errConst.desc || "-"} |`);
    }
    lines.push("");
  }

  // Variables and Constants
  if (doc.variables.size > 0 || regularConstants.length > 0) {
    lines.push("## Variables");
    lines.push("");

    for (const variable of regularConstants) {
      lines.push(...generateVariableMarkdown(variable, abi?.variables?.find((v) => v.name === variable.variableName), includeTypes));
      lines.push("");
    }

    for (const variable of doc.variables.values()) {
      lines.push(...generateVariableMarkdown(variable, abi?.variables?.find((v) => v.name === variable.variableName), includeTypes));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateFunctionMarkdown(
  func: FunctionDoc,
  abiFunc?: ClarityContract["functions"][number],
  includeTypes = true
): string[] {
  const lines: string[] = [];

  // Function header with access badge
  const accessBadge = func.access === "public" ? "public" : func.access === "read-only" ? "read-only" : "private";
  lines.push(`### \`${func.functionName}\``);
  lines.push("");
  lines.push(`\`${accessBadge}\``);
  lines.push("");

  if (func.deprecated) {
    lines.push(`> **Deprecated:** ${func.deprecated}`);
    lines.push("");
  }

  if (func.desc) {
    lines.push(func.desc);
    lines.push("");
  }

  if (func.dev) {
    lines.push(`> ${func.dev}`);
    lines.push("");
  }

  // Parameters
  if (func.params.length > 0) {
    lines.push("**Parameters:**");
    lines.push("");
    lines.push("| Name | Type | Description |");
    lines.push("|------|------|-------------|");

    for (const param of func.params) {
      const abiArg = abiFunc?.args.find((a) => a.name === param.name);
      const typeStr = includeTypes && abiArg ? `\`${formatType(abiArg.type)}\`` : "-";
      lines.push(`| \`${param.name}\` | ${typeStr} | ${param.description} |`);
    }
    lines.push("");
  }

  // Ok value
  if (func.ok) {
    const returnType = includeTypes && abiFunc ? ` (\`${formatType(abiFunc.outputs)}\`)` : "";
    lines.push(`**Ok:**${returnType} ${func.ok}`);
    lines.push("");
  }

  // Errs
  if (func.errs.length > 0) {
    lines.push("**Errs:**");
    lines.push("");
    for (const err of func.errs) {
      lines.push(`- \`${err.code}\`: ${err.description}`);
    }
    lines.push("");
  }

  // Posts (postconditions)
  if (func.posts.length > 0) {
    lines.push("**Postconditions:**");
    lines.push("");
    for (const post of func.posts) {
      lines.push(`- \`${post.asset}\`: ${post.description}`);
    }
    lines.push("");
  }

  // Examples
  if (func.examples.length > 0) {
    lines.push("**Examples:**");
    lines.push("");
    for (const example of func.examples) {
      lines.push("```clarity");
      lines.push(example);
      lines.push("```");
    }
    lines.push("");
  }

  // Prints
  if (func.prints.length > 0) {
    lines.push("**Prints:**");
    lines.push("");
    for (const p of func.prints) {
      const typeStr = p.type ? ` \`{${p.type}}\`` : "";
      lines.push(`- \`${p.name}\`${typeStr}: ${p.description}`);
    }
    lines.push("");
  }

  // Authorization (callers)
  if (func.callers.length > 0) {
    lines.push("**Authorization:**");
    lines.push("");
    for (const caller of func.callers) {
      lines.push(`- ${caller}`);
    }
    lines.push("");
  }

  // External calls
  if (func.calls.length > 0) {
    lines.push("**Calls:**");
    lines.push("");
    for (const call of func.calls) {
      const desc = call.description ? ` - ${call.description}` : "";
      lines.push(`- \`${call.contract}\` → \`${call.function}\`${desc}`);
    }
    lines.push("");
  }

  return lines;
}

function generateMapMarkdown(
  map: MapDoc,
  abiMap?: ClarityContract["maps"] extends readonly (infer T)[] | undefined ? T : never,
  includeTypes = true
): string[] {
  const lines: string[] = [];

  lines.push(`### \`${map.mapName}\``);
  lines.push("");

  if (map.deprecated) {
    lines.push(`> **Deprecated:** ${map.deprecated}`);
    lines.push("");
  }

  if (map.desc) {
    lines.push(map.desc);
    lines.push("");
  }

  if (map.dev) {
    lines.push(`> ${map.dev}`);
    lines.push("");
  }

  // Key and Value
  if (map.key || map.value || abiMap) {
    lines.push("| | Type | Description |");
    lines.push("|---|------|-------------|");

    const keyType = includeTypes && abiMap ? `\`${formatType(abiMap.key)}\`` : "-";
    const valueType = includeTypes && abiMap ? `\`${formatType(abiMap.value)}\`` : "-";

    lines.push(`| **Key** | ${keyType} | ${map.key || "-"} |`);
    lines.push(`| **Value** | ${valueType} | ${map.value || "-"} |`);
    lines.push("");
  }

  return lines;
}

function generateVariableMarkdown(
  variable: VariableDoc,
  abiVar?: ClarityContract["variables"] extends readonly (infer T)[] | undefined ? T : never,
  includeTypes = true
): string[] {
  const lines: string[] = [];

  const badge = variable.target === "constant" ? "constant" : "data-var";
  lines.push(`### \`${variable.variableName}\``);
  lines.push("");
  lines.push(`\`${badge}\``);

  if (includeTypes && abiVar) {
    lines.push(` \`${formatType(abiVar.type)}\``);
  }
  lines.push("");

  if (variable.deprecated) {
    lines.push(`> **Deprecated:** ${variable.deprecated}`);
    lines.push("");
  }

  if (variable.desc) {
    lines.push(variable.desc);
    lines.push("");
  }

  if (variable.dev) {
    lines.push(`> ${variable.dev}`);
    lines.push("");
  }

  // Examples (for constants)
  if (variable.examples && variable.examples.length > 0) {
    lines.push("**Examples:**");
    lines.push("");
    for (const example of variable.examples) {
      lines.push("```clarity");
      lines.push(example);
      lines.push("```");
    }
    lines.push("");
  }

  return lines;
}

/** Format a Clarity type for display */
function formatType(type: unknown): string {
  if (typeof type === "string") {
    return type;
  }

  if (typeof type === "object" && type !== null) {
    const obj = type as Record<string, unknown>;

    if ("optional" in obj) {
      return `(optional ${formatType(obj.optional)})`;
    }
    if ("list" in obj) {
      const list = obj.list as { type: unknown; length: number };
      return `(list ${list.length} ${formatType(list.type)})`;
    }
    if ("response" in obj) {
      const resp = obj.response as { ok: unknown; error: unknown };
      return `(response ${formatType(resp.ok)} ${formatType(resp.error)})`;
    }
    if ("tuple" in obj) {
      return "(tuple ...)";
    }
    if ("buff" in obj) {
      const buff = obj.buff as { length: number };
      return `(buff ${buff.length})`;
    }
    if ("string-ascii" in obj) {
      const str = obj["string-ascii"] as { length: number };
      return `(string-ascii ${str.length})`;
    }
    if ("string-utf8" in obj) {
      const str = obj["string-utf8"] as { length: number };
      return `(string-utf8 ${str.length})`;
    }
  }

  return String(type);
}
