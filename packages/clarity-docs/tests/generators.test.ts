import { describe, it, expect } from "vitest";
import { extractDocs } from "../src/parser/extractor";
import { generateMarkdown } from "../src/generators/markdown";
import { generateJson, toJson } from "../src/generators/json";

describe("generators", () => {
  const sampleSource = `;; @contract Counter Contract
;; @author Test Author
;; @desc A simple counter contract
;; @implements .counter-trait.counter

;; @desc The counter value
(define-data-var counter uint u0)

;; @desc Increment the counter
;; @param amount The amount to add
;; @ok The new counter value
;; @err ERR_OVERFLOW Counter would overflow
;; @caller Must be contract owner
;; @calls .token-contract transfer Pays fee
;; @prints {amount: uint, new-value: uint} counter-incremented Emitted on success
;; @example (increment u5)
(define-public (increment (amount uint))
  (ok u1))

;; @desc Get the current counter value
;; @ok The counter value
(define-read-only (get-counter)
  (var-get counter))`;

  describe("generateMarkdown", () => {
    it("should generate markdown with title", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("# Counter Contract");
    });

    it("should include contract description", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("A simple counter contract");
    });

    it("should include author", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("**Author:** Test Author");
    });

    it("should include table of contents", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("## Table of Contents");
      expect(md).toContain("- [Functions](#functions)");
      expect(md).toContain("- [Variables](#variables)");
    });

    it("should include function documentation", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("### `increment`");
      expect(md).toContain("`public`");
      expect(md).toContain("Increment the counter");
      expect(md).toContain("**Parameters:**");
      expect(md).toContain("| `amount` |");
      expect(md).toContain("The amount to add");
    });

    it("should include err documentation", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("**Errs:**");
      expect(md).toContain("`ERR_OVERFLOW`");
      expect(md).toContain("Counter would overflow");
    });

    it("should include examples", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("**Examples:**");
      expect(md).toContain("```clarity");
      expect(md).toContain("(increment u5)");
    });

    it("should include prints documentation", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("**Prints:**");
      expect(md).toContain("`counter-incremented`");
      expect(md).toContain("`{amount: uint, new-value: uint}`");
      expect(md).toContain("Emitted on success");
    });

    it("should include variable documentation", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc);

      expect(md).toContain("## Variables");
      expect(md).toContain("### `counter`");
      expect(md).toContain("`data-var`");
    });

    it("should skip TOC when disabled", () => {
      const doc = extractDocs(sampleSource);
      const md = generateMarkdown(doc, undefined, { includeToc: false });

      expect(md).not.toContain("## Table of Contents");
    });

    it("should use custom contract name", () => {
      const source = `;; Just a description
(define-data-var x uint u0)`;
      const doc = extractDocs(source);
      const md = generateMarkdown(doc, undefined, { contractName: "My Contract" });

      expect(md).toContain("# My Contract");
    });
  });

  describe("generateJson", () => {
    it("should generate valid JSON", () => {
      const doc = extractDocs(sampleSource);
      const json = generateJson(doc);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should include header information", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      expect(result.header.contract).toBe("Counter Contract");
      expect(result.header.author).toBe("Test Author");
      expect(result.header.desc).toBe("A simple counter contract");
    });

    it("should include functions", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      expect(result.functions).toHaveLength(2);

      const increment = result.functions.find(f => f.name === "increment");
      expect(increment).toBeDefined();
      expect(increment?.access).toBe("public");
      expect(increment?.params).toEqual([{ name: "amount", description: "The amount to add" }]);
      expect(increment?.errs).toEqual([{ code: "ERR_OVERFLOW", description: "Counter would overflow" }]);
    });

    it("should include prints in JSON", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      const increment = result.functions.find(f => f.name === "increment");
      expect(increment?.prints).toEqual([{
        name: "counter-incremented",
        type: "amount: uint, new-value: uint",
        description: "Emitted on success",
      }]);
    });

    it("should include variables", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      expect(result.variables).toHaveLength(1);
      expect(result.variables[0].name).toBe("counter");
      expect(result.variables[0].type).toBe("variable");
    });

    it("should generate compact JSON when not pretty", () => {
      const doc = extractDocs(sampleSource);
      const pretty = generateJson(doc, true);
      const compact = generateJson(doc, false);

      expect(compact.length).toBeLessThan(pretty.length);
      expect(compact).not.toContain("\n");
    });

    it("should include implements in header", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      expect(result.header.implements).toEqual([".counter-trait.counter"]);
    });

    it("should include calls in function", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      const increment = result.functions.find(f => f.name === "increment");
      expect(increment?.calls).toEqual([{
        contract: ".token-contract",
        function: "transfer",
        description: "Pays fee",
      }]);
    });

    it("should include caller in function", () => {
      const doc = extractDocs(sampleSource);
      const result = toJson(doc);

      const increment = result.functions.find(f => f.name === "increment");
      expect(increment?.caller).toBe("Must be contract owner");
    });
  });
});
