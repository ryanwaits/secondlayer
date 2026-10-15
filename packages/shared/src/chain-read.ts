import { createHash } from "node:crypto";

/**
 * Cache key for a contract read's arguments: SHA-256 over the hex-serialized
 * Clarity args (no `0x`, lowercase), joined by `,`.
 *
 * One function for both sides of a hosted read: the subgraph runtime hashes
 * the values it serialized, the hosted chain-read route hashes the hex it
 * received, and both land on the same `chain_read_cache.args_hash`. A
 * collision-resistant hash, because the hosted cache is shared across
 * tenants: with a weak hash, one tenant could craft args that collide with
 * another's read and pin a wrong answer to it.
 */
export function chainReadArgsHash(hexArgs: readonly string[]): string {
	const normalized = hexArgs
		.map((arg) => arg.replace(/^0x/i, "").toLowerCase())
		.join(",");
	return createHash("sha256").update(normalized).digest("hex");
}
