/**
 * Shared utilities for clarity-types
 */

/**
 * Type-level utility to convert kebab-case to camelCase
 */
export type ToCamelCase<S extends string> =
  S extends `${infer P1}-${infer P2}${infer P3}`
    ? `${P1}${Capitalize<ToCamelCase<`${P2}${P3}`>>}`
    : S;

/**
 * Runtime utility to convert kebab-case to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
