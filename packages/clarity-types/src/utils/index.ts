/**
 * Shared utilities for clarity-types
 */

/**
 * Type-level utility to convert kebab-case to camelCase
 */
type CamelCaseInner<S extends string> =
  S extends `${infer P1}-${infer P2}${infer P3}`
    ? `${P1}${Capitalize<CamelCaseInner<`${P2}${P3}`>>}`
    : S;

export type ToCamelCase<S extends string> =
  CamelCaseInner<S> extends `${number}${string}`
    ? `_${CamelCaseInner<S>}`
    : CamelCaseInner<S>;

/**
 * Runtime utility to convert kebab-case to camelCase
 *
 * Handles all edge cases:
 * - `-a` → `A` (lowercase after hyphen becomes uppercase)
 * - `-A` → `A` (uppercase after hyphen stays uppercase, hyphen removed)
 * - `-1` → `1` (digit after hyphen stays as-is, hyphen removed)
 * - Leading digits are prefixed with `_` (e.g., `1foo` → `_1foo`)
 * - Any remaining hyphens are removed
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) // Convert -a to A
    .replace(/-([A-Z])/g, (_, letter) => letter) // Convert -A to A
    .replace(/-(\d)/g, (_, digit) => digit) // Convert -1 to 1
    .replace(/-/g, "") // Remove any remaining hyphens
    .replace(/^\d/, "_$&"); // Prefix leading digits with _
}
