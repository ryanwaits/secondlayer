import { test, expect, describe } from "bun:test";
import { decodeClarityValue, decodeEventData, decodeFunctionArgs } from "../src/runtime/clarity.ts";

describe("Clarity decoding", () => {
  test("decodeClarityValue returns original on non-hex string", () => {
    expect(decodeClarityValue("hello")).toBe("hello");
  });

  test("decodeClarityValue returns original on invalid hex", () => {
    expect(decodeClarityValue("0xZZZZ")).toBe("0xZZZZ");
  });

  test("decodeEventData passes through non-string values", () => {
    expect(decodeEventData(42)).toBe(42);
    expect(decodeEventData(null)).toBe(null);
    expect(decodeEventData(true)).toBe(true);
  });

  test("decodeEventData passes through short hex strings", () => {
    expect(decodeEventData("0xabcd")).toBe("0xabcd");
  });

  test("decodeEventData recursively decodes objects", () => {
    const result = decodeEventData({ a: "hello", b: 42 });
    expect(result).toEqual({ a: "hello", b: 42 });
  });

  test("decodeEventData recursively decodes arrays", () => {
    const result = decodeEventData([1, "hello", { x: 2 }]);
    expect(result).toEqual([1, "hello", { x: 2 }]);
  });

  test("decodeFunctionArgs maps over array", () => {
    const result = decodeFunctionArgs(["hello", "world"]);
    expect(result).toEqual(["hello", "world"]);
  });
});
