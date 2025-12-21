/**
 * Utilities for stripping documentation from Clarity source
 *
 * Use cases:
 * - Reduce deployment costs for mainnet
 * - Create minified contract versions
 * - Keep only essential docs (errors) while removing verbose ones
 */

export interface StripOptions {
  /** Keep @err tags for wallet integration (default: true) */
  keepErrors?: boolean;
  /** Keep @desc tags for basic documentation (default: false) */
  keepDesc?: boolean;
  /** Keep specific tags (overrides other options) */
  keepTags?: string[];
  /** Remove all doc comments entirely (default: false) */
  removeAll?: boolean;
}

/**
 * Strip documentation comments from Clarity source
 *
 * @example
 * // Remove all docs except @err
 * const minimal = stripDocs(source, { keepErrors: true });
 *
 * @example
 * // Remove all docs entirely
 * const bare = stripDocs(source, { removeAll: true });
 *
 * @example
 * // Keep only specific tags
 * const custom = stripDocs(source, { keepTags: ['err', 'desc'] });
 */
export function stripDocs(source: string, options: StripOptions = {}): string {
  const { keepErrors = true, keepDesc = false, keepTags = [], removeAll = false } = options;

  if (removeAll) {
    return stripAllDocComments(source);
  }

  const tagsToKeep = new Set(keepTags);
  if (keepErrors) tagsToKeep.add("err");
  if (keepDesc) tagsToKeep.add("desc");

  return stripSelectiveDocs(source, tagsToKeep);
}

/** Remove all ;; doc comments */
function stripAllDocComments(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let inDocBlock = false;
  let docBlockLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith(";;")) {
      // Check if next non-empty line is a define
      if (!inDocBlock) {
        inDocBlock = true;
        docBlockLines = [i];
      } else {
        docBlockLines.push(i);
      }
    } else if (inDocBlock) {
      // End of doc block
      if (trimmed.startsWith("(define-")) {
        // This was a doc block for a definition - skip it
        inDocBlock = false;
        docBlockLines = [];
      } else if (trimmed.length === 0) {
        // Empty line continues potential doc block
        docBlockLines.push(i);
      } else {
        // Non-define, non-empty - keep these comments (not attached to define)
        for (const idx of docBlockLines) {
          result.push(lines[idx]);
        }
        inDocBlock = false;
        docBlockLines = [];
      }
      result.push(line);
    } else {
      result.push(line);
    }
  }

  // Handle trailing doc block
  if (inDocBlock) {
    for (const idx of docBlockLines) {
      result.push(lines[idx]);
    }
  }

  return result.join("\n");
}

/** Strip docs selectively, keeping specified tags */
function stripSelectiveDocs(source: string, tagsToKeep: Set<string>): string {
  const lines = source.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith(";;")) {
      // Check if this line has a tag we want to keep
      const tagMatch = trimmed.match(/^;;\s*@([a-zA-Z][a-zA-Z0-9_:-]*)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        if (tagsToKeep.has(tag) || tag.startsWith("custom:")) {
          result.push(line);
        }
        // Skip lines with tags we don't want to keep
      } else {
        // Plain comment without tag - skip if we're being selective
        // (unless it's a continuation of a kept tag, which we can't easily detect)
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Estimate deployment cost savings from stripping docs
 *
 * @returns Object with byte counts and estimated savings
 */
export function estimateStrippingSavings(
  source: string,
  options: StripOptions = {}
): { originalBytes: number; strippedBytes: number; savedBytes: number; savingsPercent: number } {
  const stripped = stripDocs(source, options);
  const originalBytes = new TextEncoder().encode(source).length;
  const strippedBytes = new TextEncoder().encode(stripped).length;
  const savedBytes = originalBytes - strippedBytes;
  const savingsPercent = originalBytes > 0 ? (savedBytes / originalBytes) * 100 : 0;

  return { originalBytes, strippedBytes, savedBytes, savingsPercent };
}
