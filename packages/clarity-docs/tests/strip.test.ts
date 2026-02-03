import { describe, it, expect } from "bun:test";
import { stripDocs, estimateStrippingSavings } from "../src/utils/strip";

describe("stripDocs", () => {
  it("should keep @err tags by default", () => {
    const source = `;; @desc This will be removed
;; @err ERR_OVERFLOW Value too large
(define-constant ERR_OVERFLOW (err u1))`;

    const result = stripDocs(source);

    expect(result).not.toContain("@desc");
    expect(result).toContain("@err ERR_OVERFLOW Value too large");
  });

  it("should strip all docs when removeAll is true", () => {
    const source = `;; @desc This will be removed
;; @err ERR_OVERFLOW Value too large
(define-constant ERR_OVERFLOW (err u1))`;

    const result = stripDocs(source, { removeAll: true });

    expect(result).not.toContain(";;");
    expect(result).toContain("(define-constant");
  });

  it("should keep continuation lines of kept tags", () => {
    const source = `;; @err ERR_OVERFLOW This is a long error
;;      description that continues
;;      on multiple lines
(define-constant ERR_OVERFLOW (err u1))`;

    const result = stripDocs(source);

    expect(result).toContain("@err ERR_OVERFLOW");
    expect(result).toContain("description that continues");
    expect(result).toContain("on multiple lines");
  });

  it("should drop continuation lines when tag is not kept", () => {
    const source = `;; @desc This is a long description
;;       that continues on another line
(define-public (test) (ok true))`;

    const result = stripDocs(source);

    expect(result).not.toContain("@desc");
    expect(result).not.toContain("continues on another line");
    expect(result).toContain("(define-public");
  });

  it("should stop continuation when new tag appears", () => {
    const source = `;; @err ERR_ONE First error
;;      continues here
;; @desc This should be dropped
;; @err ERR_TWO Second error
(define-public (test) (ok true))`;

    const result = stripDocs(source);

    expect(result).toContain("@err ERR_ONE");
    expect(result).toContain("continues here");
    expect(result).not.toContain("@desc");
    expect(result).toContain("@err ERR_TWO");
  });

  it("should keep custom: tags", () => {
    const source = `;; @custom:audit Reviewed by ABC
;; @desc This will be removed
(define-public (test) (ok true))`;

    const result = stripDocs(source);

    expect(result).toContain("@custom:audit");
    expect(result).not.toContain("@desc");
  });

  it("should keep multiple specified tags", () => {
    const source = `;; @desc Keep this
;; @dev Keep this too
;; @author Drop this
(define-public (test) (ok true))`;

    const result = stripDocs(source, { keepTags: ["desc", "dev"] });

    expect(result).toContain("@desc Keep this");
    expect(result).toContain("@dev Keep this too");
    expect(result).not.toContain("@author");
  });
});

describe("estimateStrippingSavings", () => {
  it("should calculate byte savings", () => {
    const source = `;; @desc This is documentation
(define-public (test) (ok true))`;

    const result = estimateStrippingSavings(source);

    expect(result.originalBytes).toBeGreaterThan(result.strippedBytes);
    expect(result.savedBytes).toBeGreaterThan(0);
    expect(result.savingsPercent).toBeGreaterThan(0);
  });
});
