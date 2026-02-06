/**
 * Validation for ClarityDoc documentation
 */

import type { AbiContract, AbiFunction } from "@secondlayer/stacks/clarity";
import type { ContractDoc, FunctionDoc } from "../types/doc-block";
import { isTagValidForContext, isCustomTag, type TagContext } from "../types/tags";

/** Validation error severity */
export type Severity = "error" | "warning" | "info";

/** A validation diagnostic */
export interface Diagnostic {
  severity: Severity;
  message: string;
  line?: number;
  tag?: string;
  target?: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

/** Validate tag placement for a doc block */
function validateTagPlacement(
  tags: Array<{ tag: string; line?: number }>,
  context: TagContext,
  targetName: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { tag, line } of tags) {
    if (isCustomTag(tag)) continue; // custom tags allowed everywhere

    if (!isTagValidForContext(tag, context)) {
      diagnostics.push({
        severity: "warning",
        message: `Tag '@${tag}' is not typically used on ${context} definitions (found on '${targetName}')`,
        line,
        tag,
        target: targetName,
      });
    }
  }

  return diagnostics;
}

/** Validate documentation against contract ABI */
export function validateDocs(doc: ContractDoc, abi?: AbiContract): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  // Validate tag placement for contract header
  if (doc.header.contract || doc.header.author || doc.header.desc) {
    // Header exists - we don't have tags array directly, but we can skip for now
    // The header is validated implicitly by the parser
  }

  // Validate function docs
  for (const [name, funcDoc] of doc.functions) {
    // Validate tag placement
    const tagContext: TagContext = funcDoc.access;
    const tagDiagnostics = validateTagPlacement(
      funcDoc.tags.map((t) => ({ tag: t.tag, line: t.line })),
      tagContext,
      name
    );
    diagnostics.push(...tagDiagnostics);

    // Validate function doc content
    const funcDiagnostics = validateFunctionDoc(funcDoc, abi?.functions.find((f) => f.name === name));
    diagnostics.push(...funcDiagnostics);
  }

  // Validate map docs
  for (const [name, mapDoc] of doc.maps) {
    const tagDiagnostics = validateTagPlacement(
      mapDoc.tags.map((t) => ({ tag: t.tag, line: t.line })),
      "map",
      name
    );
    diagnostics.push(...tagDiagnostics);
  }

  // Validate constant docs
  for (const [name, constDoc] of doc.constants) {
    const tagDiagnostics = validateTagPlacement(
      constDoc.tags.map((t) => ({ tag: t.tag, line: t.line })),
      "constant",
      name
    );
    diagnostics.push(...tagDiagnostics);
  }

  // Validate variable docs
  for (const [name, varDoc] of doc.variables) {
    const tagDiagnostics = validateTagPlacement(
      varDoc.tags.map((t) => ({ tag: t.tag, line: t.line })),
      "data-var",
      name
    );
    diagnostics.push(...tagDiagnostics);
  }

  // Validate trait docs
  for (const [name, traitDoc] of doc.traits) {
    const tagDiagnostics = validateTagPlacement(
      traitDoc.tags.map((t) => ({ tag: t.tag, line: t.line })),
      "trait",
      name
    );
    diagnostics.push(...tagDiagnostics);
  }

  // Check for undocumented public/read-only functions (if ABI provided)
  if (abi) {
    for (const func of abi.functions) {
      if (func.access !== "private" && !doc.functions.has(func.name)) {
        diagnostics.push({
          severity: "warning",
          message: `Function '${func.name}' is not documented`,
          target: func.name,
        });
      }
    }

    // Check for undocumented maps
    for (const map of abi.maps || []) {
      if (!doc.maps.has(map.name)) {
        diagnostics.push({
          severity: "info",
          message: `Map '${map.name}' is not documented`,
          target: map.name,
        });
      }
    }

    // Check for undocumented variables
    for (const variable of abi.variables || []) {
      const isConstant = variable.access === "constant";
      const docMap = isConstant ? doc.constants : doc.variables;
      if (!docMap.has(variable.name)) {
        diagnostics.push({
          severity: "info",
          message: `${isConstant ? "Constant" : "Variable"} '${variable.name}' is not documented`,
          target: variable.name,
        });
      }
    }
  }

  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    diagnostics,
  };
}

/** Validate a function's documentation */
function validateFunctionDoc(funcDoc: FunctionDoc, abiFunc?: AbiFunction): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const funcName = funcDoc.functionName;

  // Check for missing @desc
  if (!funcDoc.desc) {
    diagnostics.push({
      severity: "warning",
      message: `Function '${funcName}' is missing @desc description`,
      target: funcName,
      tag: "desc",
    });
  }

  // Check for missing @ok on non-private functions
  if (funcDoc.access !== "private" && !funcDoc.ok) {
    diagnostics.push({
      severity: "info",
      message: `Function '${funcName}' is missing @ok documentation`,
      target: funcName,
      tag: "ok",
    });
  }

  // Validate @param against ABI (if available)
  if (abiFunc) {
    const abiArgNames = new Set(abiFunc.args.map((a) => a.name));
    const docArgNames = new Set(funcDoc.params.map((p) => p.name));

    // Check for documented params that don't exist
    for (const param of funcDoc.params) {
      if (!abiArgNames.has(param.name)) {
        diagnostics.push({
          severity: "error",
          message: `Function '${funcName}': @param '${param.name}' does not match any function argument`,
          target: funcName,
          tag: "param",
          line: funcDoc.startLine,
        });
      }
    }

    // Check for undocumented params
    for (const arg of abiFunc.args) {
      if (!docArgNames.has(arg.name)) {
        diagnostics.push({
          severity: "warning",
          message: `Function '${funcName}': argument '${arg.name}' is not documented with @param`,
          target: funcName,
          tag: "param",
        });
      }
    }
  }

  return diagnostics;
}

/** Calculate documentation coverage metrics */
export interface CoverageMetrics {
  /** Total number of public/read-only functions */
  totalFunctions: number;
  /** Number of documented functions */
  documentedFunctions: number;
  /** Function coverage percentage (0-100) */
  functionCoverage: number;
  /** Total number of maps */
  totalMaps: number;
  /** Number of documented maps */
  documentedMaps: number;
  /** Map coverage percentage (0-100) */
  mapCoverage: number;
  /** Total number of variables/constants */
  totalVariables: number;
  /** Number of documented variables/constants */
  documentedVariables: number;
  /** Variable coverage percentage (0-100) */
  variableCoverage: number;
  /** Overall coverage percentage (0-100) */
  overallCoverage: number;
}

/** Calculate documentation coverage */
export function calculateCoverage(doc: ContractDoc, abi: AbiContract): CoverageMetrics {
  const publicFunctions = abi.functions.filter((f) => f.access !== "private");
  const totalFunctions = publicFunctions.length;
  const documentedFunctions = publicFunctions.filter((f) => doc.functions.has(f.name)).length;

  const totalMaps = abi.maps?.length || 0;
  const documentedMaps = (abi.maps || []).filter((m) => doc.maps.has(m.name)).length;

  const totalVariables = abi.variables?.length || 0;
  const documentedVariables = (abi.variables || []).filter((v) => {
    const isConstant = v.access === "constant";
    const docMap = isConstant ? doc.constants : doc.variables;
    return docMap.has(v.name);
  }).length;

  const total = totalFunctions + totalMaps + totalVariables;
  const documented = documentedFunctions + documentedMaps + documentedVariables;

  return {
    totalFunctions,
    documentedFunctions,
    functionCoverage: totalFunctions > 0 ? (documentedFunctions / totalFunctions) * 100 : 100,
    totalMaps,
    documentedMaps,
    mapCoverage: totalMaps > 0 ? (documentedMaps / totalMaps) * 100 : 100,
    totalVariables,
    documentedVariables,
    variableCoverage: totalVariables > 0 ? (documentedVariables / totalVariables) * 100 : 100,
    overallCoverage: total > 0 ? (documented / total) * 100 : 100,
  };
}
