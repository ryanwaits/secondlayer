import { defineConfig } from "bunup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/validate.ts",
    "src/schema/index.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  splitting: false,
  external: [
    "@secondlayer/shared",
    "@stacks/transactions",
    "kysely",
    "postgres",
    "zod",
  ],
});
