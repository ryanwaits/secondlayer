/**
 * clarity-types
 * TypeScript type definitions and utilities for Clarity smart contract ABIs
 */

// Primitive and composite types
export * from "./types/primitives";
export * from "./types/composites";
export * from "./types/mappings";

// ABI function types and extractors
export * from "./abi/functions";
export * from "./abi/extractors";

// Runtime validation guards
export * from "./validation/guards";

// Value converters
export * from "./converters";

// Integration types for @stacks/connect
export * from "./integration/connect";

// Shared utilities
export * from "./utils";

// Re-export key types for convenience
export type { ClarityType } from "./types/composites";

export type { ClarityToTS } from "./types/mappings";

export type {
  ClarityContract,
  ClarityFunction,
  ClarityMap,
  ClarityVariable,
  VariableAccess,
} from "./abi/functions";

export type {
  ExtractFunctionNames,
  ExtractFunctionArgs,
  ExtractFunctionOutput,
} from "./abi/extractors";

export type {
  ContractCallParams,
  ReadOnlyCallParams,
  ContractInterface,
  ContractInterfaceWithMeta,
} from "./integration/connect";

export type { ToCamelCase } from "./utils";
