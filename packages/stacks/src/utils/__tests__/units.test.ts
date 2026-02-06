import { describe, expect, test } from "bun:test";
import { formatUnits, parseUnits, formatStx, parseStx } from "../units.ts";

describe("formatUnits", () => {
  test("basic formatting", () => {
    expect(formatUnits(1000000n, 6)).toBe("1.0");
    expect(formatUnits(1500000n, 6)).toBe("1.5");
    expect(formatUnits(123456789n, 6)).toBe("123.456789");
  });

  test("zero", () => {
    expect(formatUnits(0n, 6)).toBe("0.0");
  });

  test("large values", () => {
    expect(formatUnits(1000000000000000000n, 18)).toBe("1.0");
    expect(formatUnits(123456789012345678n, 18)).toBe("0.123456789012345678");
  });

  test("sub-unit values", () => {
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(500000n, 6)).toBe("0.5");
  });

  test("negative values", () => {
    expect(formatUnits(-1500000n, 6)).toBe("-1.5");
    expect(formatUnits(-1n, 6)).toBe("-0.000001");
  });

  test("number and string inputs", () => {
    expect(formatUnits(1000000, 6)).toBe("1.0");
    expect(formatUnits("1000000", 6)).toBe("1.0");
  });
});

describe("parseUnits", () => {
  test("basic parsing", () => {
    expect(parseUnits("1.0", 6)).toBe(1000000n);
    expect(parseUnits("1.5", 6)).toBe(1500000n);
    expect(parseUnits("123.456789", 6)).toBe(123456789n);
  });

  test("no decimals", () => {
    expect(parseUnits("1", 6)).toBe(1000000n);
    expect(parseUnits("100", 6)).toBe(100000000n);
  });

  test("negative values", () => {
    expect(parseUnits("-1.5", 6)).toBe(-1500000n);
  });

  test("number input", () => {
    expect(parseUnits(1.5, 6)).toBe(1500000n);
  });

  test("zero", () => {
    expect(parseUnits("0", 6)).toBe(0n);
    expect(parseUnits("0.0", 6)).toBe(0n);
  });

  test("throws on excess decimals", () => {
    expect(() => parseUnits("1.1234567", 6)).toThrow("Too many decimal places");
  });
});

describe("formatStx / parseStx roundtrip", () => {
  test("formatStx", () => {
    expect(formatStx(1000000n)).toBe("1.0");
    expect(formatStx(0n)).toBe("0.0");
    expect(formatStx(1500000n)).toBe("1.5");
  });

  test("parseStx", () => {
    expect(parseStx("1.0")).toBe(1000000n);
    expect(parseStx("0.5")).toBe(500000n);
    expect(parseStx(1)).toBe(1000000n);
  });

  test("roundtrip", () => {
    const values = [0n, 1n, 500000n, 1000000n, 1500000n, 999999999999n];
    for (const v of values) {
      expect(parseStx(formatStx(v))).toBe(v);
    }
  });
});
