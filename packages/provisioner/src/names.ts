/**
 * Deterministic naming for tenant resources.
 *
 * Slug rules (from the master plan):
 *   - 8 chars, lowercase, [0-9a-z]
 *   - unique per host
 *   - URL-safe (used as subdomain prefix)
 */

import { randomBytes } from "node:crypto";

const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SLUG_LENGTH = 8;

export function generateSlug(): string {
	const bytes = randomBytes(SLUG_LENGTH);
	let out = "";
	for (let i = 0; i < SLUG_LENGTH; i++) {
		out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
	}
	return out;
}

export function isValidSlug(slug: string): boolean {
	if (slug.length !== SLUG_LENGTH) return false;
	for (const ch of slug) {
		if (!SLUG_ALPHABET.includes(ch)) return false;
	}
	return true;
}

export const NETWORK_TENANTS = "sl-tenants";
export const NETWORK_SOURCE = "sl-source";

export function pgContainerName(slug: string): string {
	return `sl-pg-${slug}`;
}

export function apiContainerName(slug: string): string {
	return `sl-api-${slug}`;
}

export function processorContainerName(slug: string): string {
	return `sl-proc-${slug}`;
}

export function volumeName(slug: string): string {
	return `sl-data-${slug}`;
}

/** All container names owned by a tenant, ordered for orchestration. */
export function allContainerNames(slug: string): string[] {
	return [
		pgContainerName(slug),
		apiContainerName(slug),
		processorContainerName(slug),
	];
}
