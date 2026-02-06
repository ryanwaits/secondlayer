import { describe, it, expect } from "bun:test";
import { jsToClarityValue, clarityValueToJS } from "../bridge.ts";
import { Cl } from "../values.ts";
import type { AbiType } from "../abi/types.ts";

describe("jsToClarityValue", () => {
  it("should convert uint128", () => {
    const cv = jsToClarityValue("uint128", 42n);
    expect(cv).toEqual(Cl.uint(42n));
  });

  it("should convert int128", () => {
    const cv = jsToClarityValue("int128", -5n);
    expect(cv).toEqual(Cl.int(-5n));
  });

  it("should convert bool", () => {
    expect(jsToClarityValue("bool", true)).toEqual(Cl.bool(true));
    expect(jsToClarityValue("bool", false)).toEqual(Cl.bool(false));
  });

  it("should convert principal", () => {
    const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
    const cv = jsToClarityValue("principal", addr);
    expect(cv).toEqual(Cl.principal(addr));
  });

  it("should convert contract principal", () => {
    const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract";
    const cv = jsToClarityValue("principal", addr);
    expect(cv).toEqual(Cl.principal(addr));
  });

  it("should convert string-ascii", () => {
    const type: AbiType = { "string-ascii": { length: 50 } };
    const cv = jsToClarityValue(type, "hello");
    expect(cv).toEqual(Cl.stringAscii("hello"));
  });

  it("should convert string-utf8", () => {
    const type: AbiType = { "string-utf8": { length: 100 } };
    const cv = jsToClarityValue(type, "hello 🌍");
    expect(cv).toEqual(Cl.stringUtf8("hello 🌍"));
  });

  it("should convert buffer", () => {
    const type: AbiType = { buff: { length: 4 } };
    const data = new Uint8Array([1, 2, 3, 4]);
    const cv = jsToClarityValue(type, data);
    expect(cv).toEqual(Cl.buffer(data));
  });

  it("should convert list", () => {
    const type: AbiType = { list: { type: "uint128", length: 10 } };
    const cv = jsToClarityValue(type, [1n, 2n, 3n]);
    expect(cv).toEqual(Cl.list([Cl.uint(1n), Cl.uint(2n), Cl.uint(3n)]));
  });

  it("should convert tuple", () => {
    const type: AbiType = {
      tuple: [
        { name: "amount", type: "uint128" },
        { name: "recipient", type: "principal" },
      ],
    };
    const cv = jsToClarityValue(type, {
      amount: 100n,
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    });
    expect(cv.type).toBe("tuple");
  });

  it("should convert tuple with camelCase keys", () => {
    const type: AbiType = {
      tuple: [
        { name: "user-id", type: "uint128" },
        { name: "is-active", type: "bool" },
      ],
    };
    const cv = jsToClarityValue(type, { userId: 1n, isActive: true });
    expect(cv.type).toBe("tuple");
    if (cv.type === "tuple") {
      expect(cv.value["user-id"]).toEqual(Cl.uint(1n));
      expect(cv.value["is-active"]).toEqual(Cl.bool(true));
    }
  });

  it("should convert optional (some)", () => {
    const type: AbiType = { optional: "uint128" };
    const cv = jsToClarityValue(type, 42n);
    expect(cv).toEqual(Cl.some(Cl.uint(42n)));
  });

  it("should convert optional (none)", () => {
    const type: AbiType = { optional: "uint128" };
    expect(jsToClarityValue(type, null)).toEqual(Cl.none());
    expect(jsToClarityValue(type, undefined)).toEqual(Cl.none());
  });

  it("should convert response ok", () => {
    const type: AbiType = { response: { ok: "bool", error: "uint128" } };
    const cv = jsToClarityValue(type, { ok: true });
    expect(cv).toEqual(Cl.ok(Cl.bool(true)));
  });

  it("should convert response err", () => {
    const type: AbiType = { response: { ok: "bool", error: "uint128" } };
    const cv = jsToClarityValue(type, { err: 100n });
    expect(cv).toEqual(Cl.error(Cl.uint(100n)));
  });
});

describe("clarityValueToJS", () => {
  it("should convert uint", () => {
    expect(clarityValueToJS("uint128", Cl.uint(42n))).toBe(42n);
  });

  it("should convert int", () => {
    expect(clarityValueToJS("int128", Cl.int(-5n))).toBe(-5n);
  });

  it("should convert bool", () => {
    expect(clarityValueToJS("bool", Cl.bool(true))).toBe(true);
    expect(clarityValueToJS("bool", Cl.bool(false))).toBe(false);
  });

  it("should convert principal", () => {
    const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
    expect(clarityValueToJS("principal", Cl.principal(addr))).toBe(addr);
  });

  it("should convert string-ascii", () => {
    const type: AbiType = { "string-ascii": { length: 50 } };
    expect(clarityValueToJS(type, Cl.stringAscii("hello"))).toBe("hello");
  });

  it("should convert buffer to Uint8Array", () => {
    const type: AbiType = { buff: { length: 4 } };
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = clarityValueToJS(type, Cl.buffer(data));
    expect(result).toEqual(data);
  });

  it("should convert list", () => {
    const type: AbiType = { list: { type: "uint128", length: 10 } };
    const cv = Cl.list([Cl.uint(1n), Cl.uint(2n)]);
    expect(clarityValueToJS(type, cv)).toEqual([1n, 2n]);
  });

  it("should convert tuple with camelCase keys", () => {
    const type: AbiType = {
      tuple: [
        { name: "user-id", type: "uint128" },
        { name: "is-active", type: "bool" },
      ],
    };
    const cv = Cl.tuple({
      "user-id": Cl.uint(1n),
      "is-active": Cl.bool(true),
    });
    const result = clarityValueToJS(type, cv);
    expect(result).toEqual({ userId: 1n, isActive: true });
  });

  it("should convert optional none", () => {
    const type: AbiType = { optional: "uint128" };
    expect(clarityValueToJS(type, Cl.none())).toBe(null);
  });

  it("should convert optional some", () => {
    const type: AbiType = { optional: "uint128" };
    expect(clarityValueToJS(type, Cl.some(Cl.uint(42n)))).toBe(42n);
  });

  it("should convert response ok", () => {
    const type: AbiType = { response: { ok: "bool", error: "uint128" } };
    expect(clarityValueToJS(type, Cl.ok(Cl.bool(true)))).toEqual({ ok: true });
  });

  it("should convert response err", () => {
    const type: AbiType = { response: { ok: "bool", error: "uint128" } };
    expect(clarityValueToJS(type, Cl.error(Cl.uint(100n)))).toEqual({ err: 100n });
  });
});

describe("roundtrip", () => {
  it("should roundtrip all primitive types", () => {
    const cases: [AbiType, unknown][] = [
      ["uint128", 42n],
      ["int128", -100n],
      ["bool", true],
      ["bool", false],
      ["principal", "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"],
    ];

    for (const [type, value] of cases) {
      const cv = jsToClarityValue(type, value);
      const result = clarityValueToJS(type, cv);
      expect(result).toEqual(value);
    }
  });

  it("should roundtrip strings", () => {
    const asciiType: AbiType = { "string-ascii": { length: 50 } };
    const utf8Type: AbiType = { "string-utf8": { length: 100 } };

    expect(clarityValueToJS(asciiType, jsToClarityValue(asciiType, "hello"))).toBe("hello");
    expect(clarityValueToJS(utf8Type, jsToClarityValue(utf8Type, "hello 🌍"))).toBe("hello 🌍");
  });

  it("should roundtrip buffer", () => {
    const type: AbiType = { buff: { length: 4 } };
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = clarityValueToJS(type, jsToClarityValue(type, data));
    expect(result).toEqual(data);
  });

  it("should roundtrip nested types", () => {
    const type: AbiType = {
      list: {
        type: {
          tuple: [
            { name: "id", type: "uint128" },
            { name: "active", type: "bool" },
          ],
        },
        length: 10,
      },
    };
    const value = [
      { id: 1n, active: true },
      { id: 2n, active: false },
    ];
    const cv = jsToClarityValue(type, value);
    const result = clarityValueToJS(type, cv);
    expect(result).toEqual(value);
  });
});
