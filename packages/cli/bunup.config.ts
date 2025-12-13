import { defineConfig } from "bunup";

const sharedConfig = {
  splitting: false,
  sourcemap: "linked",
  minify: false,
  external: ["esbuild", "prettier", "@hirosystems/clarinet-sdk", "@secondlayer/clarity-types"],
  noExternal: ["chalk", "commander", "fast-glob", "got", "execa"],
  shims: true,
  target: "node",
} as const;

export default defineConfig([
  {
    name: "main",
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    ...sharedConfig,
  },
  {
    name: "cli",
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    ...sharedConfig,
  },
  {
    name: "plugins",
    entry: ["src/plugins/index.ts"],
    format: ["esm"],
    dts: true,
    ...sharedConfig,
  },
  {
    name: "plugin-manager",
    entry: ["src/core/plugin-manager.ts"],
    format: ["esm"],
    dts: true,
    ...sharedConfig,
  },
]);
