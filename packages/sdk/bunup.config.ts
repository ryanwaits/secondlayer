import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/errors.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  splitting: false,
  external: ["@secondlayer/shared"],
});
