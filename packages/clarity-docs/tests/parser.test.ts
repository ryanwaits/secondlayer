import { describe, it, expect } from "vitest";
import { tokenize, parseDefine, groupCommentBlocks } from "../src/parser/lexer";
import { parseDocBlock, parseTagLine, extractParams, extractErrs, extractPrints, extractCalls, extractCallers, extractImplements } from "../src/parser/parser";
import { extractDocs } from "../src/parser/extractor";

describe("lexer", () => {
  describe("tokenize", () => {
    it("should tokenize comment lines", () => {
      const source = `;; This is a comment
;; Another comment`;
      const tokens = tokenize(source);

      expect(tokens).toHaveLength(3); // 2 comments + EOF
      expect(tokens[0]).toEqual({ type: "comment", value: "This is a comment", line: 1 });
      expect(tokens[1]).toEqual({ type: "comment", value: "Another comment", line: 2 });
      expect(tokens[2].type).toBe("eof");
    });

    it("should tokenize define expressions", () => {
      const source = `(define-public (my-function (arg uint))
  (ok u1))`;
      const tokens = tokenize(source);

      expect(tokens[0]).toEqual({
        type: "define",
        value: "(define-public (my-function (arg uint))",
        line: 1,
      });
    });

    it("should skip empty lines and single-semicolon comments", () => {
      const source = `
; single semicolon comment
;; doc comment
`;
      const tokens = tokenize(source);

      expect(tokens).toHaveLength(2); // 1 doc comment + EOF
      expect(tokens[0].type).toBe("comment");
    });
  });

  describe("parseDefine", () => {
    it("should parse public function", () => {
      const result = parseDefine("(define-public (my-function (arg uint))");
      expect(result).toEqual({
        type: "public",
        name: "my-function",
        line: 0,
        fullMatch: "(define-public (my-function (arg uint))",
      });
    });

    it("should parse read-only function", () => {
      const result = parseDefine("(define-read-only (get-value)");
      expect(result).toEqual({
        type: "read-only",
        name: "get-value",
        line: 0,
        fullMatch: "(define-read-only (get-value)",
      });
    });

    it("should parse private function", () => {
      const result = parseDefine("(define-private (helper-fn (x uint))");
      expect(result).toEqual({
        type: "private",
        name: "helper-fn",
        line: 0,
        fullMatch: "(define-private (helper-fn (x uint))",
      });
    });

    it("should parse data-var", () => {
      const result = parseDefine("(define-data-var counter uint u0)");
      expect(result).toEqual({
        type: "data-var",
        name: "counter",
        line: 0,
        fullMatch: "(define-data-var counter uint u0)",
      });
    });

    it("should parse map", () => {
      const result = parseDefine("(define-map balances principal uint)");
      expect(result).toEqual({
        type: "map",
        name: "balances",
        line: 0,
        fullMatch: "(define-map balances principal uint)",
      });
    });

    it("should parse constant", () => {
      const result = parseDefine("(define-constant MAX_VALUE u1000)");
      expect(result).toEqual({
        type: "constant",
        name: "MAX_VALUE",
        line: 0,
        fullMatch: "(define-constant MAX_VALUE u1000)",
      });
    });

    it("should parse trait", () => {
      const result = parseDefine("(define-trait my-trait ((transfer (uint principal) (response bool uint))))");
      expect(result).toEqual({
        type: "trait",
        name: "my-trait",
        line: 0,
        fullMatch: "(define-trait my-trait ((transfer (uint principal) (response bool uint))))",
      });
    });
  });

  describe("groupCommentBlocks", () => {
    it("should group consecutive comments", () => {
      const source = `;; Line 1
;; Line 2
(define-public (test))`;
      const tokens = tokenize(source);
      const blocks = groupCommentBlocks(tokens);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].block.comments).toHaveLength(2);
      expect(blocks[0].followingDefine).not.toBeNull();
      expect(blocks[0].followingDefine?.name).toBe("test");
    });

    it("should handle orphaned comment blocks", () => {
      const source = `;; Orphaned comment

(define-public (test))`;
      const tokens = tokenize(source);
      const blocks = groupCommentBlocks(tokens);

      // The comment block is followed by an "other" token (empty line behavior)
      // Actually with our tokenize, empty lines are skipped, so the define follows
      expect(blocks).toHaveLength(1);
    });
  });
});

describe("parser", () => {
  describe("parseTagLine", () => {
    it("should parse simple tag", () => {
      const result = parseTagLine("@desc This is a description", 1);
      expect(result).toEqual({
        tag: "desc",
        description: "This is a description",
        line: 1,
      });
    });

    it("should parse named tag", () => {
      const result = parseTagLine("@param amount The amount to transfer", 1);
      expect(result).toEqual({
        tag: "param",
        name: "amount",
        description: "The amount to transfer",
        line: 1,
      });
    });

    it("should parse err tag", () => {
      const result = parseTagLine("@err ERR_OVERFLOW Counter would overflow", 1);
      expect(result).toEqual({
        tag: "err",
        name: "ERR_OVERFLOW",
        description: "Counter would overflow",
        line: 1,
      });
    });

    it("should parse custom tag", () => {
      const result = parseTagLine("@custom:security Audited by XYZ", 1);
      expect(result).toEqual({
        tag: "custom:security",
        description: "Audited by XYZ",
        line: 1,
      });
    });

    it("should return null for non-tag lines", () => {
      const result = parseTagLine("Just a regular comment", 1);
      expect(result).toBeNull();
    });
  });

  describe("parseDocBlock", () => {
    it("should parse multiple tags", () => {
      const block = {
        comments: [
          { type: "comment" as const, value: "@desc A function", line: 1 },
          { type: "comment" as const, value: "@param x The x value", line: 2 },
          { type: "comment" as const, value: "@ok The result", line: 3 },
        ],
        startLine: 1,
        endLine: 3,
      };

      const result = parseDocBlock(block);

      expect(result.tags).toHaveLength(3);
      expect(result.tags[0]).toEqual({ tag: "desc", description: "A function", line: 1 });
      expect(result.tags[1]).toEqual({ tag: "param", name: "x", description: "The x value", line: 2 });
      expect(result.tags[2]).toEqual({ tag: "ok", description: "The result", line: 3 });
    });

    it("should treat free-form text as @desc", () => {
      const block = {
        comments: [
          { type: "comment" as const, value: "This is just a description", line: 1 },
        ],
        startLine: 1,
        endLine: 1,
      };

      const result = parseDocBlock(block);

      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].tag).toBe("desc");
      expect(result.tags[0].description).toBe("This is just a description");
    });

    it("should handle multiline descriptions", () => {
      const block = {
        comments: [
          { type: "comment" as const, value: "@desc First line", line: 1 },
          { type: "comment" as const, value: "continued on second line", line: 2 },
        ],
        startLine: 1,
        endLine: 2,
      };

      const result = parseDocBlock(block);

      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].description).toBe("First line continued on second line");
    });
  });

  describe("extractParams", () => {
    it("should extract param docs", () => {
      const tags = [
        { tag: "desc" as const, description: "A function", line: 1 },
        { tag: "param" as const, name: "x", description: "The x value", line: 2 },
        { tag: "param" as const, name: "y", description: "The y value", line: 3 },
      ];

      const result = extractParams(tags);

      expect(result).toEqual([
        { name: "x", description: "The x value" },
        { name: "y", description: "The y value" },
      ]);
    });
  });

  describe("extractErrs", () => {
    it("should extract err docs", () => {
      const tags = [
        { tag: "err" as const, name: "ERR_OVERFLOW", description: "Value too large", line: 1 },
        { tag: "err" as const, name: "ERR_UNAUTHORIZED", description: "Not allowed", line: 2 },
      ];

      const result = extractErrs(tags);

      expect(result).toEqual([
        { code: "ERR_OVERFLOW", description: "Value too large" },
        { code: "ERR_UNAUTHORIZED", description: "Not allowed" },
      ]);
    });
  });

  describe("parseTagLine - prints", () => {
    it("should parse @prints with type and name", () => {
      const result = parseTagLine("@prints {uint} count The iteration count", 1);
      expect(result).toEqual({
        tag: "prints",
        name: "count",
        description: "{uint} The iteration count",
        line: 1,
      });
    });

    it("should parse @prints without type", () => {
      const result = parseTagLine("@prints debug A debug message", 1);
      expect(result).toEqual({
        tag: "prints",
        name: "debug",
        description: "A debug message",
        line: 1,
      });
    });

    it("should parse @prints with tuple type", () => {
      const result = parseTagLine("@prints {from: principal, to: principal} transfer Emitted on success", 1);
      expect(result).toEqual({
        tag: "prints",
        name: "transfer",
        description: "{from: principal, to: principal} Emitted on success",
        line: 1,
      });
    });
  });

  describe("extractPrints", () => {
    it("should extract prints with name only", () => {
      const tags = [
        { tag: "prints" as const, name: "transfer", description: "Emitted on success", line: 1 },
      ];
      const result = extractPrints(tags);
      expect(result).toEqual([{ name: "transfer", description: "Emitted on success" }]);
    });

    it("should extract prints with type annotation", () => {
      const tags = [
        { tag: "prints" as const, name: "transfer", description: "{from: principal, to: principal} Emitted on success", line: 1 },
      ];
      const result = extractPrints(tags);
      expect(result).toEqual([{
        name: "transfer",
        type: "from: principal, to: principal",
        description: "Emitted on success",
      }]);
    });

    it("should extract prints with primitive type", () => {
      const tags = [
        { tag: "prints" as const, name: "count", description: "{uint} The count", line: 1 },
      ];
      const result = extractPrints(tags);
      expect(result).toEqual([{
        name: "count",
        type: "uint",
        description: "The count",
      }]);
    });
  });

  describe("parseTagLine - implements", () => {
    it("should parse @implements with local ref", () => {
      const result = parseTagLine("@implements .sip-010-trait.ft-trait", 1);
      expect(result).toEqual({
        tag: "implements",
        description: ".sip-010-trait.ft-trait",
        line: 1,
      });
    });

    it("should parse @implements with full principal", () => {
      const result = parseTagLine("@implements 'SP2C2Y.token.ft-trait", 1);
      expect(result).toEqual({
        tag: "implements",
        description: "'SP2C2Y.token.ft-trait",
        line: 1,
      });
    });
  });

  describe("parseTagLine - calls", () => {
    it("should parse @calls with local contract", () => {
      const result = parseTagLine("@calls .token-contract transfer Transfers tokens", 1);
      expect(result).toEqual({
        tag: "calls",
        name: "transfer",
        description: ".token-contract Transfers tokens",
        line: 1,
      });
    });

    it("should parse @calls with full principal", () => {
      const result = parseTagLine("@calls 'SP2C2Y.wrapped-stx wrap", 1);
      expect(result).toEqual({
        tag: "calls",
        name: "wrap",
        description: "'SP2C2Y.wrapped-stx",
        line: 1,
      });
    });
  });

  describe("parseTagLine - caller", () => {
    it("should parse @caller as freeform", () => {
      const result = parseTagLine("@caller Must be contract-owner", 1);
      expect(result).toEqual({
        tag: "caller",
        description: "Must be contract-owner",
        line: 1,
      });
    });
  });

  describe("extractCalls", () => {
    it("should extract call docs", () => {
      const tags = [
        { tag: "calls" as const, name: "transfer", description: ".token Moves tokens", line: 1 },
      ];
      const result = extractCalls(tags);
      expect(result).toEqual([{
        contract: ".token",
        function: "transfer",
        description: "Moves tokens",
      }]);
    });

    it("should extract call docs without description", () => {
      const tags = [
        { tag: "calls" as const, name: "wrap", description: "'SP2C2Y.wrapped-stx", line: 1 },
      ];
      const result = extractCalls(tags);
      expect(result).toEqual([{
        contract: "'SP2C2Y.wrapped-stx",
        function: "wrap",
        description: undefined,
      }]);
    });
  });

  describe("extractCallers", () => {
    it("should extract caller descriptions", () => {
      const tags = [
        { tag: "caller" as const, description: "Must be owner", line: 1 },
      ];
      const result = extractCallers(tags);
      expect(result).toEqual(["Must be owner"]);
    });

    it("should extract multiple callers", () => {
      const tags = [
        { tag: "caller" as const, description: "Must be owner", line: 1 },
        { tag: "caller" as const, description: "Must be whitelisted", line: 2 },
      ];
      const result = extractCallers(tags);
      expect(result).toEqual(["Must be owner", "Must be whitelisted"]);
    });
  });

  describe("extractImplements", () => {
    it("should extract implements refs", () => {
      const tags = [
        { tag: "implements" as const, description: ".sip-010.ft-trait", line: 1 },
      ];
      const result = extractImplements(tags);
      expect(result).toEqual([".sip-010.ft-trait"]);
    });

    it("should extract multiple implements", () => {
      const tags = [
        { tag: "implements" as const, description: ".sip-010.ft-trait", line: 1 },
        { tag: "implements" as const, description: ".burnable.burnable-trait", line: 2 },
      ];
      const result = extractImplements(tags);
      expect(result).toEqual([".sip-010.ft-trait", ".burnable.burnable-trait"]);
    });
  });
});

describe("extractor", () => {
  describe("extractDocs", () => {
    it("should extract contract-level documentation", () => {
      const source = `;; @contract Counter Contract
;; @author Test Author
;; @desc A simple counter

(define-data-var counter uint u0)`;

      const result = extractDocs(source);

      expect(result.header.contract).toBe("Counter Contract");
      expect(result.header.author).toBe("Test Author");
      expect(result.header.desc).toBe("A simple counter");
    });

    it("should extract function documentation", () => {
      const source = `;; @desc Increment the counter
;; @param amount The amount to add
;; @ok The new counter value
;; @err ERR_OVERFLOW Counter would overflow
(define-public (increment (amount uint))
  (ok u1))`;

      const result = extractDocs(source);

      expect(result.functions.has("increment")).toBe(true);
      const func = result.functions.get("increment")!;
      expect(func.desc).toBe("Increment the counter");
      expect(func.params).toEqual([{ name: "amount", description: "The amount to add" }]);
      expect(func.ok).toBe("The new counter value");
      expect(func.errs).toEqual([{ code: "ERR_OVERFLOW", description: "Counter would overflow" }]);
      expect(func.access).toBe("public");
    });

    it("should extract map documentation", () => {
      const source = `;; @desc User balances
;; @key principal The user address
;; @value uint The balance
(define-map balances principal uint)`;

      const result = extractDocs(source);

      expect(result.maps.has("balances")).toBe(true);
      const map = result.maps.get("balances")!;
      expect(map.desc).toBe("User balances");
      expect(map.key).toBe("principal The user address");
      expect(map.value).toBe("uint The balance");
    });

    it("should extract variable documentation", () => {
      const source = `;; @desc The counter value
;; @dev Initialized to zero
(define-data-var counter uint u0)`;

      const result = extractDocs(source);

      expect(result.variables.has("counter")).toBe(true);
      const variable = result.variables.get("counter")!;
      expect(variable.desc).toBe("The counter value");
      expect(variable.dev).toBe("Initialized to zero");
    });

    it("should extract constant documentation", () => {
      const source = `;; @desc Maximum allowed value
(define-constant MAX_VALUE u1000)`;

      const result = extractDocs(source);

      expect(result.constants.has("MAX_VALUE")).toBe(true);
      const constant = result.constants.get("MAX_VALUE")!;
      expect(constant.desc).toBe("Maximum allowed value");
    });

    it("should handle complete contract", () => {
      const source = `;; @contract Complete Contract
;; @author Developer

;; @desc The counter
(define-data-var counter uint u0)

;; @desc Get counter
;; @ok Current value
(define-read-only (get-counter)
  (var-get counter))

;; @desc Increment
;; @param n Amount
(define-public (increment (n uint))
  (ok (var-set counter (+ (var-get counter) n))))`;

      const result = extractDocs(source);

      expect(result.header.contract).toBe("Complete Contract");
      expect(result.variables.size).toBe(1);
      expect(result.functions.size).toBe(2);
      expect(result.functions.get("get-counter")?.access).toBe("read-only");
      expect(result.functions.get("increment")?.access).toBe("public");
    });
  });
});
