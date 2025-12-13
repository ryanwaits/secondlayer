/**
 * React Plugin for @secondlayer/cli
 * Generates React hooks for contract interfaces and generic Stacks functionality
 */

import type { PluginFactory, GenerateContext } from "../../types/plugin";
import type { ReactPluginOptions } from "./types";
import { generateProvider } from "./provider/index";
import { generateGenericHooks } from "./generators/generic";
import { generateContractHooks } from "./generators/contract";

/**
 * React plugin factory
 */
export const react: PluginFactory<ReactPluginOptions> = (options = {}) => {
  const excludeList = options.exclude || [];

  return {
    name: "@secondlayer/cli/plugin-react",
    version: "1.0.0",

    async generate(context: GenerateContext): Promise<void> {
      if (options.debug) {
        context.logger.debug(
          `React plugin generating hooks (excluding: ${excludeList.join(", ") || "none"})`
        );
      }

      // Generate provider (always generated)
      const provider = await generateProvider();
      context.addOutput("provider", {
        path: "./src/generated/provider.tsx",
        content: provider,
        type: "config",
      });

      // Generate generic hooks (all by default, minus excludes)
      const genericHooks = await generateGenericHooks(excludeList);
      context.addOutput("generic-hooks", {
        path: "./src/generated/hooks.ts",
        content: genericHooks,
        type: "hooks",
      });

      // Generate contract hooks (all contracts, minus excludes)
      if (context.contracts.length > 0) {
        const contractHooks = await generateContractHooks(
          context.contracts,
          excludeList
        );

        // Only add output if there are hooks to generate
        if (contractHooks.trim()) {
          context.addOutput("contract-hooks", {
            path: "./src/generated/contract-hooks.ts",
            content: contractHooks,
            type: "hooks",
          });
        }
      }

      if (options.debug) {
        context.logger.success(
          `React plugin generated ${context.contracts.length} contract hook sets`
        );
      }
    },
  };
};

// Re-export types for convenience
export type { ReactPluginOptions } from "./types";
