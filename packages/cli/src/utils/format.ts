/**
 * Shared code formatting utilities
 */

import { format, type Options } from "prettier";

/**
 * Default Prettier options for generated TypeScript code
 */
export const PRETTIER_OPTIONS: Options = {
  parser: "typescript",
  singleQuote: true,
  semi: true,
  printWidth: 100,
  trailingComma: "es5",
};

/**
 * Format TypeScript code using shared Prettier configuration
 */
export async function formatCode(code: string): Promise<string> {
  return format(code, PRETTIER_OPTIONS);
}
