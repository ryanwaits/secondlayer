import { defineConfig } from "bunup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/validate.ts",
    "src/schema/index.ts",
    "src/runtime/reindex.ts",
    "src/runtime/block-processor.ts",
    "src/runtime/catchup.ts",
    "src/runtime/context.ts",
    "src/runtime/processor.ts",
    "src/runtime/reorg.ts",
    "src/runtime/runner.ts",
    "src/runtime/source-matcher.ts",
    "src/runtime/clarity.ts",
    "src/service.ts",
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
