import { defineConfig, type DefineConfigItem } from "bunup";

const config: DefineConfigItem = defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/bin-http.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  splitting: false,
  external: [
    "@modelcontextprotocol/sdk",
    "@secondlayer/sdk",
    "@secondlayer/subgraphs",
    "esbuild",
    "zod",
  ],
}) as DefineConfigItem;
export default config;
