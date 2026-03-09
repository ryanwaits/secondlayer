import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/index.ts", "src/streams/index.ts", "src/views/index.ts", "src/contracts/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  splitting: false,
  external: ["@secondlayer/shared"],
});
