import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  external: ["kysely", "kysely-postgres-js", "postgres", "pluralize"],
});
