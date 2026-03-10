import { defineConfig, type DefineConfigItem } from "bunup";

const config: DefineConfigItem = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: "linked",
  minify: false,
}) as DefineConfigItem;
export default config;
