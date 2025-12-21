/**
 * ClarityDoc tag types and definitions
 */

/** Standard ClarityDoc tags (SIP-014 aligned) */
export type StandardTag =
  | "contract"
  | "author"
  | "desc"
  | "dev"
  | "param"
  | "ok"
  | "err"
  | "post"
  | "prints"
  | "example"
  | "key"
  | "value"
  | "version"
  | "deprecated"
  | "see"
  | "implements"
  | "calls"
  | "caller"
  | "uri"
  | "hash";

/** Custom tag format: @custom:name */
export type CustomTag = `custom:${string}`;

/** All valid ClarityDoc tags */
export type ClarityDocTag = StandardTag | CustomTag;

/** Tags valid at contract level */
export type ContractLevelTag = "contract" | "author" | "desc" | "dev" | "version" | "deprecated" | "see" | "implements" | "uri" | "hash" | CustomTag;

/** Tags valid for functions */
export type FunctionTag =
  | "desc"
  | "dev"
  | "param"
  | "ok"
  | "err"
  | "post"
  | "prints"
  | "example"
  | "version"
  | "deprecated"
  | "see"
  | "calls"
  | "caller"
  | CustomTag;

/** Tags valid for maps */
export type MapTag = "desc" | "dev" | "key" | "value" | "version" | "deprecated" | "see" | CustomTag;

/** Tags valid for variables and constants */
export type VariableTag = "desc" | "dev" | "version" | "deprecated" | "see" | "err" | "example" | CustomTag;

/** Check if a string is a valid standard tag */
export function isStandardTag(tag: string): tag is StandardTag {
  const standardTags: readonly string[] = [
    "contract",
    "author",
    "desc",
    "dev",
    "param",
    "ok",
    "err",
    "post",
    "prints",
    "example",
    "key",
    "value",
    "version",
    "deprecated",
    "see",
    "implements",
    "calls",
    "caller",
    "uri",
    "hash",
  ];
  return standardTags.includes(tag);
}

/** Check if a string is a valid custom tag */
export function isCustomTag(tag: string): tag is CustomTag {
  return tag.startsWith("custom:");
}

/** Check if a string is a valid ClarityDoc tag */
export function isClarityDocTag(tag: string): tag is ClarityDocTag {
  return isStandardTag(tag) || isCustomTag(tag);
}

/** Tags that accept a name argument (e.g., @param name description) */
export const NAMED_TAGS = ["param", "err", "post", "key", "value", "prints", "calls"] as const;
export type NamedTag = (typeof NAMED_TAGS)[number];

export function isNamedTag(tag: string): tag is NamedTag {
  return (NAMED_TAGS as readonly string[]).includes(tag);
}

/** Definition context types for tag validation */
export type TagContext = "contract" | "public" | "read-only" | "private" | "data-var" | "map" | "constant" | "trait";

/** Tag placement rules: maps each standard tag to valid definition contexts */
export const TAG_RULES: Record<StandardTag, readonly TagContext[]> = {
  contract: ["contract"],
  author: ["contract"],
  desc: ["contract", "public", "read-only", "private", "data-var", "map", "constant", "trait"],
  dev: ["contract", "public", "read-only", "private", "data-var", "map", "constant", "trait"],
  version: ["contract", "public", "read-only", "private", "data-var", "map", "constant", "trait"],
  deprecated: ["contract", "public", "read-only", "private", "data-var", "map", "constant", "trait"],
  see: ["contract", "public", "read-only", "private", "data-var", "map", "constant", "trait"],
  implements: ["contract"],
  uri: ["contract"],
  hash: ["contract"],
  param: ["public", "read-only", "private"],
  ok: ["public", "read-only", "private"],
  err: ["public", "read-only", "private", "constant"],
  post: ["public", "read-only", "private"],
  prints: ["public", "read-only", "private"],
  example: ["public", "read-only", "private", "constant"],
  calls: ["public", "read-only", "private"],
  caller: ["public", "read-only", "private"],
  key: ["map"],
  value: ["map"],
};

/** Check if a tag is valid for a given definition context */
export function isTagValidForContext(tag: string, context: TagContext): boolean {
  if (isCustomTag(tag)) return true; // custom tags allowed everywhere
  if (!isStandardTag(tag)) return false;
  return TAG_RULES[tag].includes(context);
}
