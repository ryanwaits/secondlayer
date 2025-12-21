/**
 * Lexer for tokenizing Clarity source comments
 */

/** Token types for documentation parsing */
export type TokenType = "comment" | "define" | "other" | "eof";

/** A lexer token */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

/** Define expression types */
export type DefineType = "public" | "read-only" | "private" | "data-var" | "map" | "constant" | "trait";

/** Information about a define expression */
export interface DefineInfo {
  type: DefineType;
  name: string;
  line: number;
  fullMatch: string;
}

/** Tokenize Clarity source into tokens */
export function tokenize(source: string): Token[] {
  const lines = source.split("\n");
  const tokens: Token[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1; // 1-indexed

    if (trimmed.startsWith(";;")) {
      // Documentation comment
      tokens.push({
        type: "comment",
        value: trimmed.slice(2).trim(),
        line: lineNum,
      });
    } else if (trimmed.startsWith("(define-")) {
      // Define expression
      tokens.push({
        type: "define",
        value: trimmed,
        line: lineNum,
      });
    } else if (trimmed.length > 0 && !trimmed.startsWith(";")) {
      // Other non-empty, non-comment line
      tokens.push({
        type: "other",
        value: trimmed,
        line: lineNum,
      });
    }
    // Skip empty lines and single-semicolon comments
  }

  tokens.push({ type: "eof", value: "", line: lines.length + 1 });
  return tokens;
}

/** Parse a define expression to extract type and name */
export function parseDefine(defineExpr: string): DefineInfo | null {
  // Match (define-TYPE (NAME ...) or (define-TYPE NAME
  const patterns: Array<{ regex: RegExp; type: DefineType }> = [
    // Functions: (define-public (name ...)
    { regex: /^\(define-public\s+\(([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "public" },
    { regex: /^\(define-read-only\s+\(([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "read-only" },
    { regex: /^\(define-private\s+\(([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "private" },
    // Variables: (define-data-var NAME type value)
    { regex: /^\(define-data-var\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "data-var" },
    // Maps: (define-map NAME { key: type } { value: type })
    { regex: /^\(define-map\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "map" },
    // Constants: (define-constant NAME value)
    { regex: /^\(define-constant\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "constant" },
    // Traits: (define-trait NAME ((func ...)))
    { regex: /^\(define-trait\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*/, type: "trait" },
  ];

  for (const { regex, type } of patterns) {
    const match = defineExpr.match(regex);
    if (match) {
      return {
        type,
        name: match[1],
        line: 0, // Will be set by caller
        fullMatch: defineExpr,
      };
    }
  }

  return null;
}

/** Group consecutive comment tokens into blocks */
export interface CommentBlock {
  comments: Token[];
  startLine: number;
  endLine: number;
}

export function groupCommentBlocks(tokens: Token[]): Array<{ block: CommentBlock; followingDefine: DefineInfo | null }> {
  const result: Array<{ block: CommentBlock; followingDefine: DefineInfo | null }> = [];
  let currentBlock: Token[] = [];
  let blockStart = 0;
  let lastCommentLine = 0;

  const flushBlock = (followingDefine: DefineInfo | null) => {
    if (currentBlock.length > 0) {
      const block: CommentBlock = {
        comments: [...currentBlock],
        startLine: blockStart,
        endLine: currentBlock[currentBlock.length - 1].line,
      };
      result.push({ block, followingDefine });
      currentBlock = [];
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "comment") {
      // Check if there's a gap (empty line) between this comment and the last
      if (currentBlock.length > 0 && token.line > lastCommentLine + 1) {
        // Gap detected - flush current block as orphaned
        flushBlock(null);
      }

      if (currentBlock.length === 0) {
        blockStart = token.line;
      }
      currentBlock.push(token);
      lastCommentLine = token.line;
    } else if (currentBlock.length > 0) {
      // End of comment block
      let followingDefine: DefineInfo | null = null;
      if (token.type === "define") {
        const defineInfo = parseDefine(token.value);
        if (defineInfo) {
          defineInfo.line = token.line;
          followingDefine = defineInfo;
        }
      }

      flushBlock(followingDefine);
    }
  }

  return result;
}
