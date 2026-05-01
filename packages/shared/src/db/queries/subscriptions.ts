import { type Kysely, sql } from "kysely";
import { generateSecret } from "../../crypto/hmac.ts";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.ts";
import type {
	Database,
	InsertSubscription,
	Subscription,
	SubscriptionFormat,
	SubscriptionRuntime,
	SubscriptionStatus,
	UpdateSubscription,
} from "../types.ts";

/**
 * Subscription CRUD. `signing_secret_enc` is transparently encrypted via
 * `encryptSecret`/`decryptSecret`. Plaintext secrets only leave via the
 * return value of `create` (one-time display) and `rotateSecret`.
 */

export interface CreateSubscriptionInput {
	accountId: string;
	projectId?: string | null;
	name: string;
	subgraphName: string;
	tableName: string;
	filter?: unknown;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime | null;
	url: string;
	authConfig?: unknown;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface CreateSubscriptionResult {
	subscription: Subscription;
	/** Plaintext signing secret — surfaced once, never stored decrypted. */
	signingSecret: string;
}

export async function createSubscription(
	db: Kysely<Database>,
	input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
	const signingSecret = generateSecret();
	const row: InsertSubscription = {
		account_id: input.accountId,
		project_id: input.projectId ?? null,
		name: input.name,
		status: "active",
		subgraph_name: input.subgraphName,
		table_name: input.tableName,
		filter: input.filter ?? {},
		format: input.format ?? "standard-webhooks",
		runtime: input.runtime ?? null,
		url: input.url,
		signing_secret_enc: encryptSecret(signingSecret),
		auth_config: input.authConfig ?? {},
		...(input.maxRetries !== undefined
			? { max_retries: input.maxRetries }
			: {}),
		...(input.timeoutMs !== undefined ? { timeout_ms: input.timeoutMs } : {}),
		...(input.concurrency !== undefined
			? { concurrency: input.concurrency }
			: {}),
	};
	const subscription = await db
		.insertInto("subscriptions")
		.values(row)
		.returningAll()
		.executeTakeFirstOrThrow();
	return { subscription, signingSecret };
}

export async function listSubscriptions(
	db: Kysely<Database>,
	accountId: string,
): Promise<Subscription[]> {
	return db
		.selectFrom("subscriptions")
		.selectAll()
		.where("account_id", "=", accountId)
		.orderBy("created_at", "desc")
		.execute();
}

export async function getSubscription(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<Subscription | null> {
	const row = await db
		.selectFrom("subscriptions")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("id", "=", id)
		.executeTakeFirst();
	return row ?? null;
}

export async function getSubscriptionByName(
	db: Kysely<Database>,
	accountId: string,
	name: string,
): Promise<Subscription | null> {
	const row = await db
		.selectFrom("subscriptions")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("name", "=", name)
		.executeTakeFirst();
	return row ?? null;
}

export interface UpdateSubscriptionInput {
	name?: string;
	filter?: unknown;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime | null;
	url?: string;
	authConfig?: unknown;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export async function updateSubscription(
	db: Kysely<Database>,
	accountId: string,
	id: string,
	patch: UpdateSubscriptionInput,
): Promise<Subscription | null> {
	const update: UpdateSubscription = { updated_at: new Date() };
	if (patch.name !== undefined) update.name = patch.name;
	if (patch.filter !== undefined) update.filter = patch.filter;
	if (patch.format !== undefined) update.format = patch.format;
	if (patch.runtime !== undefined) update.runtime = patch.runtime;
	if (patch.url !== undefined) update.url = patch.url;
	if (patch.authConfig !== undefined) update.auth_config = patch.authConfig;
	if (patch.maxRetries !== undefined) update.max_retries = patch.maxRetries;
	if (patch.timeoutMs !== undefined) update.timeout_ms = patch.timeoutMs;
	if (patch.concurrency !== undefined) update.concurrency = patch.concurrency;

	const row = await db
		.updateTable("subscriptions")
		.set(update)
		.where("account_id", "=", accountId)
		.where("id", "=", id)
		.returningAll()
		.executeTakeFirst();
	return row ?? null;
}

export async function toggleSubscriptionStatus(
	db: Kysely<Database>,
	accountId: string,
	id: string,
	status: SubscriptionStatus,
): Promise<Subscription | null> {
	const row = await db
		.updateTable("subscriptions")
		.set({
			status,
			updated_at: new Date(),
			...(status === "active"
				? {
						circuit_failures: 0,
						circuit_opened_at: null,
					}
				: {}),
		})
		.where("account_id", "=", accountId)
		.where("id", "=", id)
		.returningAll()
		.executeTakeFirst();
	return row ?? null;
}

export async function deleteSubscription(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<boolean> {
	const res = await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.where("id", "=", id)
		.executeTakeFirst();
	return Number(res.numDeletedRows ?? 0) > 0;
}

export interface RotateSecretResult {
	subscription: Subscription;
	signingSecret: string;
}

export async function rotateSubscriptionSecret(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<RotateSecretResult | null> {
	const signingSecret = generateSecret();
	const row = await db
		.updateTable("subscriptions")
		.set({
			signing_secret_enc: encryptSecret(signingSecret),
			updated_at: new Date(),
		})
		.where("account_id", "=", accountId)
		.where("id", "=", id)
		.returningAll()
		.executeTakeFirst();
	if (!row) return null;
	return { subscription: row, signingSecret };
}

/** Decrypt a subscription's signing secret for HMAC signing at emit time. */
export function getSubscriptionSigningSecret(sub: Subscription): string {
	return decryptSecret(sub.signing_secret_enc);
}

/** Fire `subscriptions:changed` notify so the emitter hot-reloads its cache. */
export async function notifySubscriptionsChanged(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await sql`SELECT pg_notify('subscriptions:changed', ${accountId})`.execute(
		db,
	);
}
