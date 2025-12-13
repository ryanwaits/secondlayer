/**
 * Testing plugin for @secondlayer/cli
 * Generates type-safe helpers for Clarinet SDK unit tests
 */

import type { PluginFactory, GenerateContext } from "../../types/plugin";
import { generateTestingHelpers } from "./generators";

export interface TestingPluginOptions {
  /** Include only specific contracts */
  include?: string[];

  /** Exclude specific contracts */
  exclude?: string[];

  /** Output path for generated testing helpers (default: ./src/generated/testing.ts) */
  out?: string;

  /** Include private function helpers (default: false) */
  includePrivate?: boolean;

  /** Enable debug output */
  debug?: boolean;
}

export const testing: PluginFactory<TestingPluginOptions> = (options = {}) => {
  return {
    name: "@secondlayer/cli/plugin-testing",
    version: "1.0.0",

    async generate(context: GenerateContext): Promise<void> {
      const { contracts } = context;

      // Filter contracts based on options
      const filteredContracts = contracts.filter((contract) => {
        if (options.include && !options.include.includes(contract.name)) {
          return false;
        }
        if (options.exclude && options.exclude.includes(contract.name)) {
          return false;
        }
        return true;
      });

      if (filteredContracts.length === 0) {
        if (options.debug) {
          context.logger.debug("Testing plugin: No contracts to process");
        }
        return;
      }

      if (options.debug) {
        context.logger.debug(
          `Testing plugin: Generating helpers for ${filteredContracts.length} contracts`
        );
      }

      // Generate testing helpers
      const testingCode = await generateTestingHelpers(
        filteredContracts,
        options
      );

      const outputPath = options.out || "./src/generated/testing.ts";

      context.addOutput("testing", {
        path: outputPath,
        content: testingCode,
        type: "utils",
      });

      if (options.debug) {
        context.logger.debug(
          `Testing plugin: Generated helpers for ${filteredContracts.length} contracts`
        );
      }
    },
  };
};
