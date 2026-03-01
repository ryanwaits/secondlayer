import { describe, expect, test } from "bun:test";
import { rubyToJs, evalExpr } from "../repl/eval.ts";

describe("rubyToJs", () => {
  test("rewrites .where(key: val)", () => {
    expect(rubyToJs('Account.where(email: "test@test.com")')).toBe(
      'Account.where({ email: "test@test.com" })',
    );
  });

  test("rewrites .not(key: val)", () => {
    expect(rubyToJs('Account.not(plan: "free")')).toBe(
      'Account.not({ plan: "free" })',
    );
  });

  test("rewrites .findBy(key: val)", () => {
    expect(rubyToJs('Account.findBy(email: "a@b.com")')).toBe(
      'Account.findBy({ email: "a@b.com" })',
    );
  });

  test("does not rewrite already-braced", () => {
    const input = 'Account.where({ email: "test" })';
    expect(rubyToJs(input)).toBe(input);
  });

  test("handles chained calls", () => {
    expect(rubyToJs('Account.where(plan: "pro").limit(5)')).toBe(
      'Account.where({ plan: "pro" }).limit(5)',
    );
  });

  test("leaves non-matching input alone", () => {
    expect(rubyToJs("Account.count")).toBe("Account.count");
    expect(rubyToJs("1 + 1")).toBe("1 + 1");
  });
});

describe("evalExpr", () => {
  test("evaluates simple expression", async () => {
    expect(await evalExpr("1 + 1", {})).toBe(2);
  });

  test("uses context variables", async () => {
    expect(await evalExpr("x * 2", { x: 21 })).toBe(42);
  });

  test("evaluates async expressions", async () => {
    expect(await evalExpr("await Promise.resolve(42)", {})).toBe(42);
  });

  test("string expressions", async () => {
    expect(await evalExpr('"hello".toUpperCase()', {})).toBe("HELLO");
  });

  test("throws on invalid expression", async () => {
    expect(evalExpr("???", {})).rejects.toThrow();
  });
});
