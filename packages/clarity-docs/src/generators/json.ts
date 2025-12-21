/**
 * Generate JSON output from ClarityDoc
 */

import type { ContractDoc, FunctionDoc, MapDoc, VariableDoc, TraitDoc } from "../types/doc-block";

/** JSON-serializable function documentation */
export interface JsonFunctionDoc {
  name: string;
  access: "public" | "read-only" | "private";
  desc?: string;
  dev?: string;
  params: Array<{ name: string; description: string }>;
  ok?: string;
  errs: Array<{ code: string; description: string }>;
  posts: Array<{ asset: string; description: string }>;
  examples: string[];
  prints: Array<{ name: string; type?: string; description: string }>;
  calls: Array<{ contract: string; function: string; description?: string }>;
  callers: string[];
  deprecated?: string;
  version?: string;
  see: string[];
}

/** JSON-serializable map documentation */
export interface JsonMapDoc {
  name: string;
  desc?: string;
  dev?: string;
  key?: string;
  value?: string;
  deprecated?: string;
  version?: string;
  see: string[];
}

/** JSON-serializable variable documentation */
export interface JsonVariableDoc {
  name: string;
  type: "variable" | "constant";
  desc?: string;
  dev?: string;
  deprecated?: string;
  version?: string;
  see: string[];
  /** For error constants: marks this as an error constant */
  isError?: boolean;
  /** For error constants: human-readable error description */
  errorDescription?: string;
  /** For error constants: extracted error code (e.g., "u67") */
  errorCode?: string;
  /** Usage examples */
  examples?: string[];
}

/** JSON-serializable trait documentation */
export interface JsonTraitDoc {
  name: string;
  desc?: string;
  dev?: string;
  deprecated?: string;
  version?: string;
  see: string[];
}

/** JSON-serializable contract documentation */
export interface JsonContractDoc {
  header: {
    contract?: string;
    author?: string;
    desc?: string;
    dev?: string;
    version?: string;
    deprecated?: string;
    see: string[];
    implements: string[];
    custom: Record<string, string>;
    /** Off-chain documentation URL */
    uri?: string;
    /** Documentation hash for integrity verification */
    docsHash?: string;
  };
  functions: JsonFunctionDoc[];
  maps: JsonMapDoc[];
  variables: JsonVariableDoc[];
  constants: JsonVariableDoc[];
  traits: JsonTraitDoc[];
  sourcePath?: string;
}

/** Convert ContractDoc to JSON-serializable format */
export function toJson(doc: ContractDoc): JsonContractDoc {
  return {
    header: {
      contract: doc.header.contract,
      author: doc.header.author,
      desc: doc.header.desc,
      dev: doc.header.dev,
      version: doc.header.version,
      deprecated: doc.header.deprecated,
      see: doc.header.see,
      implements: doc.header.implements,
      custom: Object.fromEntries(doc.header.custom),
      uri: doc.header.uri,
      docsHash: doc.header.docsHash,
    },
    functions: Array.from(doc.functions.values()).map(convertFunction),
    maps: Array.from(doc.maps.values()).map(convertMap),
    variables: Array.from(doc.variables.values()).map((v) => convertVariable(v, "variable")),
    constants: Array.from(doc.constants.values()).map((v) => convertVariable(v, "constant")),
    traits: Array.from(doc.traits.values()).map(convertTrait),
    sourcePath: doc.sourcePath,
  };
}

function convertFunction(func: FunctionDoc): JsonFunctionDoc {
  return {
    name: func.functionName,
    access: func.access,
    desc: func.desc,
    dev: func.dev,
    params: func.params,
    ok: func.ok,
    errs: func.errs,
    posts: func.posts,
    examples: func.examples,
    prints: func.prints,
    calls: func.calls,
    callers: func.callers,
    deprecated: func.deprecated,
    version: func.version,
    see: func.see,
  };
}

function convertMap(map: MapDoc): JsonMapDoc {
  return {
    name: map.mapName,
    desc: map.desc,
    dev: map.dev,
    key: map.key,
    value: map.value,
    deprecated: map.deprecated,
    version: map.version,
    see: map.see,
  };
}

function convertVariable(variable: VariableDoc, type: "variable" | "constant"): JsonVariableDoc {
  return {
    name: variable.variableName,
    type,
    desc: variable.desc,
    dev: variable.dev,
    deprecated: variable.deprecated,
    version: variable.version,
    see: variable.see,
    isError: variable.isError,
    errorDescription: variable.errorDescription,
    errorCode: variable.errorCode,
    examples: variable.examples,
  };
}

function convertTrait(trait: TraitDoc): JsonTraitDoc {
  return {
    name: trait.traitName,
    desc: trait.desc,
    dev: trait.dev,
    deprecated: trait.deprecated,
    version: trait.version,
    see: trait.see,
  };
}

/** Generate JSON string from ContractDoc */
export function generateJson(doc: ContractDoc, pretty = true): string {
  const json = toJson(doc);
  return pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
}
