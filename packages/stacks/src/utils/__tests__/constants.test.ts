import { describe, expect, test } from "bun:test";
import {
  MAX_U128,
  MAX_I128,
  MIN_I128,
  AddressVersion,
  ZERO_ADDRESS,
  TESTNET_ZERO_ADDRESS,
  MICROSTX_PER_STX,
} from "../constants.ts";

describe("constants", () => {
  test("MAX_U128 is 2^128 - 1", () => {
    expect(MAX_U128).toBe((1n << 128n) - 1n);
    expect(MAX_U128).toBe(340282366920938463463374607431768211455n);
  });

  test("MAX_I128 is 2^127 - 1", () => {
    expect(MAX_I128).toBe((1n << 127n) - 1n);
    expect(MAX_I128).toBe(170141183460469231731687303715884105727n);
  });

  test("MIN_I128 is -(2^127)", () => {
    expect(MIN_I128).toBe(-(1n << 127n));
    expect(MIN_I128).toBe(-170141183460469231731687303715884105728n);
  });

  test("i128 range is symmetric except off-by-one", () => {
    expect(MAX_I128 + MIN_I128).toBe(-1n);
  });

  test("AddressVersion values", () => {
    expect(AddressVersion.MainnetSingleSig).toBe(22);
    expect(AddressVersion.MainnetMultiSig).toBe(20);
    expect(AddressVersion.TestnetSingleSig).toBe(26);
    expect(AddressVersion.TestnetMultiSig).toBe(21);
  });

  test("ZERO_ADDRESS is a valid mainnet address", () => {
    expect(ZERO_ADDRESS).toMatch(/^SP/);
  });

  test("TESTNET_ZERO_ADDRESS is a valid testnet address", () => {
    expect(TESTNET_ZERO_ADDRESS).toMatch(/^ST/);
  });

  test("MICROSTX_PER_STX is 1_000_000", () => {
    expect(MICROSTX_PER_STX).toBe(1_000_000n);
  });
});
