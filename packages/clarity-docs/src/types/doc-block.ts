/**
 * ClarityDoc block and documentation types
 */

import type { ClarityDocTag } from "./tags";

/** A single parsed documentation tag */
export interface DocTag {
  /** The tag name (without @) */
  tag: ClarityDocTag;
  /** Optional name argument for tags like @param */
  name?: string;
  /** The tag description */
  description: string;
  /** Line number in source (1-indexed) */
  line: number;
}

/** A block of documentation comments */
export interface DocBlock {
  /** All parsed tags in the block */
  tags: DocTag[];
  /** Raw text of all comments (without ;; prefix) */
  rawText: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
}

/** Parameter documentation */
export interface ParamDoc {
  name: string;
  description: string;
}

/** Error documentation */
export interface ErrDoc {
  code: string;
  description: string;
}

/** Print/event documentation */
export interface PrintDoc {
  name: string;
  type?: string;
  description: string;
}

/** Postcondition documentation (asset transfers, mints, etc.) */
export interface PostDoc {
  /** Asset identifier (stx, token-name, etc.) */
  asset: string;
  description: string;
}

/** Contract call dependency documentation */
export interface CallDoc {
  /** Contract reference (.contract or 'SP...contract) */
  contract: string;
  /** Function being called */
  function: string;
  /** Optional description */
  description?: string;
}

/** Documentation for a function */
export interface FunctionDoc extends DocBlock {
  /** The target type */
  target: "function";
  /** Function name */
  functionName: string;
  /** Function access level */
  access: "public" | "read-only" | "private";
  /** Documented parameters */
  params: ParamDoc[];
  /** Ok value documentation */
  ok?: string;
  /** Error cases */
  errs: ErrDoc[];
  /** Postconditions (asset transfers, mints) */
  posts: PostDoc[];
  /** Usage examples */
  examples: string[];
  /** Print statements documented */
  prints: PrintDoc[];
  /** External contract calls */
  calls: CallDoc[];
  /** Authorization requirements */
  callers: string[];
  /** Description (human-readable) */
  desc?: string;
  /** Developer notes */
  dev?: string;
  /** Deprecation notice */
  deprecated?: string;
  /** Version/deployment info */
  version?: string;
  /** Cross-references */
  see: string[];
}

/** Documentation for a map */
export interface MapDoc extends DocBlock {
  target: "map";
  mapName: string;
  /** Key type documentation */
  key?: string;
  /** Value type documentation */
  value?: string;
  desc?: string;
  dev?: string;
  deprecated?: string;
  version?: string;
  see: string[];
}

/** Documentation for a variable or constant */
export interface VariableDoc extends DocBlock {
  target: "variable" | "constant";
  variableName: string;
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

/** Documentation for a trait definition */
export interface TraitDoc extends DocBlock {
  target: "trait";
  traitName: string;
  desc?: string;
  dev?: string;
  deprecated?: string;
  version?: string;
  see: string[];
}

/** Contract-level documentation */
export interface ContractHeaderDoc {
  /** Contract name/title */
  contract?: string;
  /** Author info */
  author?: string;
  /** Contract description */
  desc?: string;
  /** Developer notes */
  dev?: string;
  /** Version info */
  version?: string;
  /** Deprecation notice */
  deprecated?: string;
  /** Cross-references */
  see: string[];
  /** Implemented traits */
  implements: string[];
  /** Custom tags */
  custom: Map<string, string>;
  /** Off-chain documentation URL */
  uri?: string;
  /** Documentation hash for integrity verification */
  docsHash?: string;
}

/** Complete contract documentation */
export interface ContractDoc {
  /** Contract header documentation */
  header: ContractHeaderDoc;
  /** Function documentation by name */
  functions: Map<string, FunctionDoc>;
  /** Map documentation by name */
  maps: Map<string, MapDoc>;
  /** Variable documentation by name */
  variables: Map<string, VariableDoc>;
  /** Constant documentation by name */
  constants: Map<string, VariableDoc>;
  /** Trait documentation by name */
  traits: Map<string, TraitDoc>;
  /** Source file path (if available) */
  sourcePath?: string;
}

/** Create an empty contract documentation object */
export function createEmptyContractDoc(): ContractDoc {
  return {
    header: {
      see: [],
      implements: [],
      custom: new Map(),
    },
    functions: new Map(),
    maps: new Map(),
    variables: new Map(),
    constants: new Map(),
    traits: new Map(),
  };
}
