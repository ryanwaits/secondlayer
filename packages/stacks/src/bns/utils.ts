import type { FullyQualifiedName } from "./types.ts";
import { DEFAULT_NAMESPACE } from "./constants.ts";
import { hash160 } from "../utils/hash.ts";

/**
 * Parse a fully qualified name string into components.
 * Supports:
 * - "name.namespace" → { name: "name", namespace: "namespace" }
 * - "name" → { name: "name", namespace: "btc" } (default)
 */
export function parseFQN(fqn: string): FullyQualifiedName {
  const parts = fqn.split(".");

  if (parts.length === 1) {
    return {
      name: parts[0]!,
      namespace: DEFAULT_NAMESPACE,
    };
  }

  if (parts.length === 2) {
    return {
      name: parts[0]!,
      namespace: parts[1]!,
    };
  }

  throw new Error(
    `Invalid fully qualified name: ${fqn}. Expected format: "name.namespace" or "name"`
  );
}

/**
 * Format name components into FQN string.
 */
export function formatFQN(name: string, namespace: string): string {
  return `${name}.${namespace}`;
}

/**
 * Validate name format.
 * Names must be:
 * - 1-48 characters
 * - Lowercase alphanumeric, hyphens, underscores
 * - Cannot start or end with hyphen/underscore
 */
export function validateName(name: string): boolean {
  if (name.length < 1 || name.length > 48) return false;

  const regex = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;
  return regex.test(name);
}

/**
 * Validate namespace format.
 * Namespaces must be:
 * - 1-20 characters
 * - Lowercase alphanumeric
 */
export function validateNamespace(namespace: string): boolean {
  if (namespace.length < 1 || namespace.length > 20) return false;

  const regex = /^[a-z0-9]+$/;
  return regex.test(namespace);
}

/**
 * Validate a fully qualified name.
 */
export function validateFQN(fqn: string): boolean {
  try {
    const { name, namespace } = parseFQN(fqn);
    return validateName(name) && validateNamespace(namespace);
  } catch {
    return false;
  }
}

/**
 * Generate a random 20-byte salt for name preorders.
 * @returns Random Uint8Array of length 20
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(20);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Calculate hash160 for name preorder commitment.
 * Hash format: hash160(name + namespace + salt)
 *
 * @param name - BNS name (without namespace)
 * @param namespace - BNS namespace (e.g., "btc")
 * @param salt - 20-byte random salt
 * @returns 20-byte hash160 commitment
 */
export function hashPreorder(
  name: string,
  namespace: string,
  salt: Uint8Array
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const namespaceBytes = new TextEncoder().encode(namespace);

  // Concatenate: name + namespace + salt
  const combined = new Uint8Array(
    nameBytes.length + namespaceBytes.length + salt.length
  );
  combined.set(nameBytes, 0);
  combined.set(namespaceBytes, nameBytes.length);
  combined.set(salt, nameBytes.length + namespaceBytes.length);

  return hash160(combined);
}
