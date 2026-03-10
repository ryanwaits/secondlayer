import { defineConfig, type DefineConfigItem } from "bunup";

const config: DefineConfigItem = defineConfig({
  entry: ["src/index.ts", "src/streams/index.ts", "src/views/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  minify: false,
  splitting: false,
  external: ["@secondlayer/shared"],
}) as DefineConfigItem;
export default config;
