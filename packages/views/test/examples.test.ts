import { test, expect, describe } from "bun:test";
import { validateViewDefinition } from "../src/validate.ts";
import * as fs from "fs";

const EXAMPLES_DIR = `${import.meta.dir}/../../../examples/views`;
const examplesExist = fs.existsSync(EXAMPLES_DIR);

describe.skipIf(!examplesExist)("example views validate", () => {
  test("stx-transfers example validates", async () => {
    const mod = await import(`${EXAMPLES_DIR}/stx-transfers.ts`);
    const def = mod.default;
    expect(() => validateViewDefinition(def)).not.toThrow();
  });

  test("nft-marketplace example validates", async () => {
    const mod = await import(`${EXAMPLES_DIR}/nft-marketplace.ts`);
    const def = mod.default;
    expect(() => validateViewDefinition(def)).not.toThrow();
  });

  test("pox-stacking example validates", async () => {
    const mod = await import(`${EXAMPLES_DIR}/pox-stacking.ts`);
    const def = mod.default;
    expect(() => validateViewDefinition(def)).not.toThrow();
  });
});
