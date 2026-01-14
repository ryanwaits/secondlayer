/**
 * Extract complete documentation from Clarity source files
 */

import type {
  ContractDoc,
  ContractHeaderDoc,
  FunctionDoc,
  MapDoc,
  TraitDoc,
  VariableDoc,
} from "../types/doc-block";
import { createEmptyContractDoc } from "../types/doc-block";
import type { DefineInfo } from "./lexer";
import { groupCommentBlocks, tokenize } from "./lexer";
import {
  extractCaller,
  extractCalls,
  extractCustomTags,
  extractErrs,
  extractFirstTagValue,
  extractImplements,
  extractParams,
  extractPosts,
  extractPrints,
  extractTagValues,
  parseDocBlock,
} from "./parser";

/** Contract-level tags that indicate a block is a header, not definition docs */
const CONTRACT_LEVEL_TAGS = ["contract", "author"] as const;

/** Check if a doc block contains contract-level tags */
function isContractHeader(parsed: ReturnType<typeof parseDocBlock>): boolean {
  return parsed.tags.some((t) => (CONTRACT_LEVEL_TAGS as readonly string[]).includes(t.tag));
}

/** Extract documentation from Clarity source code */
export function extractDocs(source: string, sourcePath?: string): ContractDoc {
  const tokens = tokenize(source);
  const blocks = groupCommentBlocks(tokens);
  const doc = createEmptyContractDoc();

  if (sourcePath) {
    doc.sourcePath = sourcePath;
  }

  // Track if we've processed the header
  let headerProcessed = false;

  for (const { block, followingDefine } of blocks) {
    const parsed = parseDocBlock(block);

    // Check if this is a contract header (first block with @title or @author)
    if (!headerProcessed && isContractHeader(parsed)) {
      doc.header = buildContractHeader(parsed);
      headerProcessed = true;
      continue;
    }

    // First unattached block without contract tags is also treated as header
    if (!followingDefine && !headerProcessed) {
      doc.header = buildContractHeader(parsed);
      headerProcessed = true;
      continue;
    }

    if (!followingDefine) {
      // Unattached doc block after header - skip
      continue;
    }

    // Attach documentation to the definition
    switch (followingDefine.type) {
      case "public":
      case "read-only":
      case "private":
        doc.functions.set(followingDefine.name, buildFunctionDoc(parsed, followingDefine));
        break;
      case "map":
        doc.maps.set(followingDefine.name, buildMapDoc(parsed, followingDefine));
        break;
      case "data-var":
        doc.variables.set(followingDefine.name, buildVariableDoc(parsed, followingDefine, "variable"));
        break;
      case "constant":
        doc.constants.set(followingDefine.name, buildVariableDoc(parsed, followingDefine, "constant"));
        break;
      case "trait":
        doc.traits.set(followingDefine.name, buildTraitDoc(parsed, followingDefine));
        break;
    }
  }

  return doc;
}

function buildContractHeader(parsed: ReturnType<typeof parseDocBlock>): ContractHeaderDoc {
  return {
    contract: extractFirstTagValue(parsed.tags, "contract"),
    author: extractFirstTagValue(parsed.tags, "author"),
    desc: extractFirstTagValue(parsed.tags, "desc"),
    dev: extractFirstTagValue(parsed.tags, "dev"),
    version: extractFirstTagValue(parsed.tags, "version"),
    deprecated: extractFirstTagValue(parsed.tags, "deprecated"),
    see: extractTagValues(parsed.tags, "see"),
    implements: extractImplements(parsed.tags),
    custom: extractCustomTags(parsed.tags),
    uri: extractFirstTagValue(parsed.tags, "uri"),
    docsHash: extractFirstTagValue(parsed.tags, "hash"),
  };
}

function buildFunctionDoc(
  parsed: ReturnType<typeof parseDocBlock>,
  define: DefineInfo
): FunctionDoc {
  return {
    ...parsed,
    target: "function",
    functionName: define.name,
    access: define.type as "public" | "read-only" | "private",
    params: extractParams(parsed.tags),
    ok: extractFirstTagValue(parsed.tags, "ok"),
    errs: extractErrs(parsed.tags),
    posts: extractPosts(parsed.tags),
    examples: extractTagValues(parsed.tags, "example"),
    prints: extractPrints(parsed.tags),
    calls: extractCalls(parsed.tags),
    caller: extractCaller(parsed.tags),
    desc: extractFirstTagValue(parsed.tags, "desc"),
    dev: extractFirstTagValue(parsed.tags, "dev"),
    deprecated: extractFirstTagValue(parsed.tags, "deprecated"),
    version: extractFirstTagValue(parsed.tags, "version"),
    see: extractTagValues(parsed.tags, "see"),
  };
}

function buildMapDoc(
  parsed: ReturnType<typeof parseDocBlock>,
  define: DefineInfo
): MapDoc {
  // For @key and @value, the "name" field contains the type info
  const keyTag = parsed.tags.find((t) => t.tag === "key");
  const valueTag = parsed.tags.find((t) => t.tag === "value");

  return {
    ...parsed,
    target: "map",
    mapName: define.name,
    key: keyTag ? (keyTag.name ? `${keyTag.name} ${keyTag.description}` : keyTag.description) : undefined,
    value: valueTag
      ? valueTag.name
        ? `${valueTag.name} ${valueTag.description}`
        : valueTag.description
      : undefined,
    desc: extractFirstTagValue(parsed.tags, "desc"),
    dev: extractFirstTagValue(parsed.tags, "dev"),
    deprecated: extractFirstTagValue(parsed.tags, "deprecated"),
    version: extractFirstTagValue(parsed.tags, "version"),
    see: extractTagValues(parsed.tags, "see"),
  };
}

function buildVariableDoc(
  parsed: ReturnType<typeof parseDocBlock>,
  define: DefineInfo,
  target: "variable" | "constant"
): VariableDoc {
  const doc: VariableDoc = {
    ...parsed,
    target,
    variableName: define.name,
    desc: extractFirstTagValue(parsed.tags, "desc"),
    dev: extractFirstTagValue(parsed.tags, "dev"),
    deprecated: extractFirstTagValue(parsed.tags, "deprecated"),
    version: extractFirstTagValue(parsed.tags, "version"),
    see: extractTagValues(parsed.tags, "see"),
    examples: extractTagValues(parsed.tags, "example"),
  };

  // For constants, check for @err tag (error constant support)
  if (target === "constant") {
    const errTag = parsed.tags.find((t) => t.tag === "err");
    if (errTag) {
      doc.isError = true;
      doc.errorDescription = errTag.description;
      // Try to extract error code from the define expression: (err uXX)
      const errorCodeMatch = define.fullMatch.match(/\(err\s+u(\d+)\)/);
      if (errorCodeMatch) {
        doc.errorCode = `u${errorCodeMatch[1]}`;
      }
    }
  }

  return doc;
}

function buildTraitDoc(
  parsed: ReturnType<typeof parseDocBlock>,
  define: DefineInfo
): TraitDoc {
  return {
    ...parsed,
    target: "trait",
    traitName: define.name,
    desc: extractFirstTagValue(parsed.tags, "desc"),
    dev: extractFirstTagValue(parsed.tags, "dev"),
    deprecated: extractFirstTagValue(parsed.tags, "deprecated"),
    version: extractFirstTagValue(parsed.tags, "version"),
    see: extractTagValues(parsed.tags, "see"),
  };
}

/** Convenience function to extract docs from a file path */
export async function extractDocsFromFile(filePath: string): Promise<ContractDoc> {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(filePath, "utf-8");
  return extractDocs(source, filePath);
}
