/**
 * Parser for extracting structured documentation from comment blocks
 */

import type { CallDoc, ClarityDocTag, DocBlock, DocTag, ErrDoc, ParamDoc, PostDoc, PrintDoc } from "../types/index";
import { isClarityDocTag, isNamedTag } from "../types/tags";
import type { CommentBlock } from "./lexer";

/** Parse a single comment line for @tag content */
export function parseTagLine(line: string, lineNum: number): DocTag | null {
  // Match @tag pattern at start of line
  const tagMatch = line.match(/^@([a-zA-Z][a-zA-Z0-9_:-]*)\s*(.*)?$/);
  if (!tagMatch) {
    return null;
  }

  const tagName = tagMatch[1];
  const rest = (tagMatch[2] || "").trim();

  if (!isClarityDocTag(tagName)) {
    // Unknown tag, treat as custom if it doesn't match standard pattern
    return null;
  }

  // Special handling for @calls <contract-ref> <function> [description]
  if (tagName === "calls") {
    // Match: .contract func OR 'SP...CONTRACT func
    const callsMatch = rest.match(/^([.''][^\s]+)\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*(.*)?$/);
    if (callsMatch) {
      return {
        tag: "calls" as ClarityDocTag,
        name: callsMatch[2], // function name
        description: `${callsMatch[1]} ${(callsMatch[3] || "").trim()}`.trim(),
        line: lineNum,
      };
    }
  }

  // Special handling for @prints {type}? name description
  if (tagName === "prints") {
    // Check for optional type annotation: @prints {type} name description
    const printsWithType = rest.match(/^\{([^}]+)\}\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*(.*)?$/);
    if (printsWithType) {
      return {
        tag: "prints" as ClarityDocTag,
        name: printsWithType[2],
        description: `{${printsWithType[1]}} ${(printsWithType[3] || "").trim()}`.trim(),
        line: lineNum,
      };
    }
    // Fall through to normal named tag parsing for @prints name description
  }

  // For named tags (@param name desc, @error CODE desc), extract the name
  if (isNamedTag(tagName)) {
    const namedMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*(.*)?$/);
    if (namedMatch) {
      return {
        tag: tagName as ClarityDocTag,
        name: namedMatch[1],
        description: (namedMatch[2] || "").trim(),
        line: lineNum,
      };
    }
    // Named tag without proper name - still parse it
    return {
      tag: tagName as ClarityDocTag,
      description: rest,
      line: lineNum,
    };
  }

  return {
    tag: tagName as ClarityDocTag,
    description: rest,
    line: lineNum,
  };
}

/** Parse a comment block into a structured DocBlock */
export function parseDocBlock(block: CommentBlock): DocBlock {
  const tags: DocTag[] = [];
  const rawLines: string[] = [];
  let currentTag: DocTag | null = null;

  for (const comment of block.comments) {
    const line = comment.value;
    rawLines.push(line);

    // Check if this line starts a new tag
    const tag = parseTagLine(line, comment.line);

    if (tag) {
      // Save previous tag if exists
      if (currentTag) {
        tags.push(currentTag);
      }
      currentTag = tag;
    } else if (currentTag && line.length > 0) {
      // Continuation of previous tag description
      currentTag.description = currentTag.description ? `${currentTag.description} ${line}` : line;
    } else if (!currentTag && line.length > 0) {
      // Free-form text before any tag - treat as @desc
      currentTag = {
        tag: "desc",
        description: line,
        line: comment.line,
      };
    }
  }

  // Don't forget the last tag
  if (currentTag) {
    tags.push(currentTag);
  }

  return {
    tags,
    rawText: rawLines.join("\n"),
    startLine: block.startLine,
    endLine: block.endLine,
  };
}

/** Extract @param tags as ParamDoc array */
export function extractParams(tags: DocTag[]): ParamDoc[] {
  return tags
    .filter((t) => t.tag === "param" && t.name)
    .map((t) => ({
      name: t.name!,
      description: t.description,
    }));
}

/** Extract @err tags as ErrDoc array */
export function extractErrs(tags: DocTag[]): ErrDoc[] {
  return tags
    .filter((t) => t.tag === "err" && t.name)
    .map((t) => ({
      code: t.name!,
      description: t.description,
    }));
}

/** Extract @post tags as PostDoc array */
export function extractPosts(tags: DocTag[]): PostDoc[] {
  return tags
    .filter((t) => t.tag === "post" && t.name)
    .map((t) => ({
      asset: t.name!,
      description: t.description,
    }));
}

/** Extract @prints tags as PrintDoc array */
export function extractPrints(tags: DocTag[]): PrintDoc[] {
  return tags
    .filter((t) => t.tag === "prints" && t.name)
    .map((t) => {
      // Check if description starts with type annotation {..}
      const typeMatch = t.description.match(/^\{([^}]+)\}\s*(.*)/);
      if (typeMatch) {
        return {
          name: t.name!,
          type: typeMatch[1],
          description: typeMatch[2],
        };
      }
      return {
        name: t.name!,
        description: t.description,
      };
    });
}

/** Extract all tags of a specific type */
export function extractTagValues(tags: DocTag[], tagName: ClarityDocTag): string[] {
  return tags.filter((t) => t.tag === tagName).map((t) => t.description);
}

/** Extract the first tag value of a specific type */
export function extractFirstTagValue(tags: DocTag[], tagName: ClarityDocTag): string | undefined {
  const tag = tags.find((t) => t.tag === tagName);
  return tag?.description;
}

/** Extract custom tags as a Map */
export function extractCustomTags(tags: DocTag[]): Map<string, string> {
  const custom = new Map<string, string>();
  for (const tag of tags) {
    if (tag.tag.startsWith("custom:")) {
      const customName = tag.tag.slice(7); // Remove "custom:" prefix
      custom.set(customName, tag.description);
    }
  }
  return custom;
}

/** Extract @calls tags as CallDoc array */
export function extractCalls(tags: DocTag[]): CallDoc[] {
  return tags
    .filter((t) => t.tag === "calls" && t.name)
    .map((t) => {
      // Description contains: "<contract-ref> [optional description]"
      const parts = t.description.split(/\s+/);
      const contract = parts[0];
      const description = parts.slice(1).join(" ") || undefined;
      return {
        contract,
        function: t.name!,
        description,
      };
    });
}

/** Extract first @caller tag as string */
export function extractCaller(tags: DocTag[]): string | undefined {
  const tag = tags.find((t) => t.tag === "caller");
  return tag?.description;
}

/** Extract @implements tags as string array */
export function extractImplements(tags: DocTag[]): string[] {
  return tags
    .filter((t) => t.tag === "implements")
    .map((t) => t.description);
}
