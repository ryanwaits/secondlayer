import { decryptSecret } from "@secondlayer/shared/crypto/secrets";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";

/**
 * Workflow signer secret store. Fetches encrypted HMAC secrets from
 * `workflow_signer_secrets` and decrypts via shared KMS envelope. Caches
 * decrypted values in memory for 5 minutes so rotation (swap row + wait
 * TTL) doesn't require a workflow redeploy.
 *
 * The plaintext secret never appears in any persistent log — callers pass
 * it straight through to `createHmac(...)` calls in the remote-signer HTTP
 * client and discard.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
	value: string;
	expiresAt: number;
}

export class SignerSecretStore {
	private readonly cache = new Map<string, CacheEntry>();

	constructor(private readonly db: Kysely<Database>) {}

	/**
	 * Fetch the plaintext secret for `(accountId, name)`. Throws if the
	 * secret doesn't exist so the caller can surface a meaningful error
	 * to the workflow run log.
	 */
	async get(accountId: string, name: string): Promise<string> {
		const key = `${accountId}\u0000${name}`;
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) return cached.value;

		const row = await this.db
			.selectFrom("workflow_signer_secrets")
			.select(["encrypted_value"])
			.where("account_id", "=", accountId)
			.where("name", "=", name)
			.executeTakeFirst();

		if (!row) {
			throw new Error(
				`Signer secret "${name}" not found for account ${accountId}. ` +
					`Set it with: sl secrets set ${name} <value>`,
			);
		}

		let value: string;
		try {
			value = decryptSecret(Buffer.from(row.encrypted_value));
		} catch (err) {
			logger.error(
				"signer-secret: decrypt failed — likely SECONDLAYER_SECRETS_KEY mismatch",
				{ err: String(err), name, accountId },
			);
			throw new Error(
				`Signer secret "${name}" could not be decrypted. Check SECONDLAYER_SECRETS_KEY matches the one used to write.`,
			);
		}

		this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
		return value;
	}

	/** Explicit cache invalidation (for tests, or after rotation). */
	invalidate(accountId: string, name: string): void {
		this.cache.delete(`${accountId}\u0000${name}`);
	}

	invalidateAll(): void {
		this.cache.clear();
	}
}
