/**
 * Bastion user management.
 *
 * The bastion container (`secondlayer-bastion`) ships with helper scripts
 * that create/remove tenant SSH users. The provisioner drives those scripts
 * via docker exec; state (pubkeys, sshd drop-ins) lives on a bind mount so
 * it survives container restarts.
 *
 * See `docker/bastion/` for the container, sshd config, and tenant-add/
 * tenant-remove scripts.
 */

import { logger } from "@secondlayer/shared";
import { containerExec } from "./docker.ts";

const BASTION_CONTAINER =
	process.env.BASTION_CONTAINER ?? "secondlayer-bastion";

/** Minimal pubkey shape check. We don't verify the key cryptographically —
 * sshd does that at connection time. We only guard against obviously bad
 * input that could break the bastion's authorized_keys file. */
function assertValidPubkey(pubkey: string): void {
	const trimmed = pubkey.trim();
	if (!trimmed) throw new Error("Empty SSH public key");
	if (trimmed.includes("\n"))
		throw new Error("SSH public key must be a single line");
	if (
		!/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+\S+/.test(
			trimmed,
		)
	) {
		throw new Error(
			"SSH public key must start with a recognized algorithm (ssh-rsa, ssh-ed25519, ecdsa-*)",
		);
	}
}

/**
 * Add/update the bastion user for a tenant. Idempotent — rerunning with a
 * different pubkey rotates the credential.
 *
 * Tenants then connect via:
 *   ssh -N -L 5432:sl-pg-<slug>:5432 tenant-<slug>@bastion.secondlayer.tools -p 2222
 */
export async function addBastionUser(
	slug: string,
	pubkey: string,
): Promise<void> {
	assertValidPubkey(pubkey);
	logger.info("Adding bastion user", { slug });
	const result = await containerExec(BASTION_CONTAINER, [
		"/usr/local/bin/tenant-add.sh",
		slug,
		pubkey.trim(),
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`tenant-add.sh exited with code ${result.exitCode} for slug=${slug}`,
		);
	}
}

/**
 * Remove a tenant's bastion user. Safe to call on a slug that was never
 * added — the script is idempotent.
 */
export async function removeBastionUser(slug: string): Promise<void> {
	logger.info("Removing bastion user", { slug });
	const result = await containerExec(BASTION_CONTAINER, [
		"/usr/local/bin/tenant-remove.sh",
		slug,
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`tenant-remove.sh exited with code ${result.exitCode} for slug=${slug}`,
		);
	}
}
