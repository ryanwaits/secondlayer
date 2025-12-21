/**
 * @secondlayer/clarity-docs
 *
 * ClarityDoc - Documentation comment standard and tooling for Clarity smart contracts
 */

// Types
export * from "./types/index";

// Parser
export { tokenize, parseDefine, groupCommentBlocks } from "./parser/lexer";
export type { Token, TokenType, DefineType, DefineInfo, CommentBlock } from "./parser/lexer";
export { parseTagLine, parseDocBlock, extractParams, extractErrs, extractPosts, extractPrints, extractTagValues, extractFirstTagValue, extractCustomTags, extractCalls, extractCallers, extractImplements } from "./parser/parser";
export { extractDocs, extractDocsFromFile } from "./parser/extractor";

// Validation
export { validateDocs, calculateCoverage } from "./validation/validators";
export type { Severity, Diagnostic, ValidationResult, CoverageMetrics } from "./validation/validators";

// Generators
export { generateMarkdown } from "./generators/markdown";
export type { MarkdownOptions } from "./generators/markdown";
export { generateJson, toJson } from "./generators/json";
export type { JsonContractDoc, JsonFunctionDoc, JsonMapDoc, JsonVariableDoc, JsonTraitDoc } from "./generators/json";

// Utils
export { stripDocs, estimateStrippingSavings } from "./utils/index";
export type { StripOptions } from "./utils/index";
