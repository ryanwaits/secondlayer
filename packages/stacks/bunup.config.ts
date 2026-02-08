import { defineConfig } from "bunup";

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
    "src/bns/index.ts",
    "src/pox/index.ts",
    "src/stackingdao/index.ts",
    "src/subscriptions/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: "linked",
  minify: false,
});
