import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/accounts/index.ts",
    "src/chains/index.ts",
    "src/clarity/index.ts",
    "src/actions/index.ts",
    "src/postconditions/index.ts",
    "src/transactions/index.ts",
    "src/utils/index.ts",
    "src/connect/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
