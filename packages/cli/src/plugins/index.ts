/**
 * Plugin exports for @secondlayer/cli
 * This will be expanded as plugins are implemented
 */

import type { SecondLayerPlugin } from "../types/plugin";

// Re-export plugin types for convenience
export type {
  SecondLayerPlugin,
  PluginFactory,
  PluginOptions,
  GenerateContext,
  PluginContext,
  Logger,
  PluginUtils,
} from "../types/plugin";

// Plugin utilities
export { PluginManager } from "../core/plugin-manager";

// Base plugin options interface
export interface BasePluginOptions {
  /** Include only specific contracts/functions */
  include?: string[];

  /** Exclude specific contracts/functions */
  exclude?: string[];

  /** Enable debug output */
  debug?: boolean;
}

/**
 * Utility function to filter contracts/functions based on include/exclude options
 */
export function filterByOptions<T extends { name: string }>(
  items: T[],
  options: BasePluginOptions = {}
): T[] {
  let filtered = items;

  if (options.include && options.include.length > 0) {
    filtered = filtered.filter((item) =>
      options.include!.some(
        (pattern) =>
          item.name.includes(pattern) || item.name.match(new RegExp(pattern))
      )
    );
  }

  if (options.exclude && options.exclude.length > 0) {
    filtered = filtered.filter(
      (item) =>
        !options.exclude!.some(
          (pattern) =>
            item.name.includes(pattern) || item.name.match(new RegExp(pattern))
        )
    );
  }

  return filtered;
}

/**
 * Utility function to create a simple plugin
 */
export function createPlugin(
  name: string,
  version: string,
  implementation: Partial<SecondLayerPlugin>
): SecondLayerPlugin {
  return {
    name,
    version,
    ...implementation,
  };
}

// Plugin exports
export { clarinet, hasClarinetProject } from "./clarinet/index";
export type { ClarinetPluginOptions } from "./clarinet/index";

export { actions } from "./actions/index";
export type { ActionsPluginOptions } from "./actions/index";

export { react } from "./react/index";
export type { ReactPluginOptions } from "./react/index";

export { testing } from "./testing/index";
export type { TestingPluginOptions } from "./testing/index";

