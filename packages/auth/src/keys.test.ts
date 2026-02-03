import { test, expect } from "bun:test";
import { generateApiKey, hashApiKey } from "./keys.ts";

test("generated key has correct prefix format", () => {
  const { raw, prefix } = generateApiKey();
  expect(raw).toMatch(/^sk-sl_[0-9a-f]{32}$/);
  expect(prefix).toMatch(/^sk-sl_[0-9a-f]{8}$/);
  expect(raw.startsWith(prefix)).toBe(true);
});

test("hash is deterministic", () => {
  const { raw, hash } = generateApiKey();
  expect(hashApiKey(raw)).toBe(hash);
});

test("1000 keys are unique", () => {
  const keys = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    keys.add(generateApiKey().raw);
  }
  expect(keys.size).toBe(1000);
});
