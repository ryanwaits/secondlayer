import { type Kysely, sql } from "kysely";
import { generateSecret } from "../../crypto/hmac.ts";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.ts";
import { isPlatformMode } from "../../mode.ts";
import type {
	Database,
	InsertWebhook,
	UpdateWebhook,
	Webhook,
	WebhookFormat,
	WebhookKind,
	WebhookRuntime,
	WebhookStatus,
} from "../types.ts";

/**
 * Webhook CRUD. `signing_secret_enc` is transparently encrypted via
 * `encryptSecret`/`decryptSecret`. Plaintext secrets only leave via the
 * return value of `create` (one-time display) and `rotateSecret`.
 */

export interface CreateWebhookInput {
	accountId: string;
	projectId?: string | null;
	name: string;
	/** Defaults to "subgraph". Chain webhooks set kind="chain" + triggers. */
	kind?: WebhookKind;
	/** Required for subgraph webhooks; omitted for chain. */
	subgraphName?: string | null;
	/** Required for subgraph webhooks; omitted for chain. */
	tableName?: string | null;
	/** Chain-trigger filter array. Required for chain webhooks. */
	triggers?: unknown;
	filter?: unknown;
	format?: WebhookFormat;
	runtime?: WebhookRuntime | null;
	url: string;
	authConfig?: unknown;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface CreateWebhookResult {
	webhook: Webhook;
	/** Plaintext signing secret — surfaced once, never stored decrypted. */
	signingSecret: string;
}

export async function createWebhook(
	db: Kysely<Database>,
	input: CreateWebhookInput,
): Promise<CreateWebhookResult> {
	const signingSecret = generateSecret();
	const kind: WebhookKind = input.kind ?? "subgraph";
	const row: InsertWebhook = {
		account_id: isPlatformMode() ? input.accountId : "",
		project_id: input.projectId ?? null,
		name: input.name,
		status: "active",
		kind,
		subgraph_name: input.subgraphName ?? null,
		table_name: input.tableName ?? null,
		triggers: kind === "chain" ? ((input.triggers ?? []) as unknown) : null,
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
	const webhook = await db
		.insertInto("webhooks")
		.values(row)
		.returningAll()
		.executeTakeFirstOrThrow();
	return { webhook, signingSecret };
}

export async function listWebhooks(
	db: Kysely<Database>,
	accountId: string,
	opts?: { limit?: number; offset?: number },
): Promise<Webhook[]> {
	let q = db.selectFrom("webhooks").selectAll().orderBy("created_at", "desc");
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	if (opts?.limit !== undefined) q = q.limit(opts.limit);
	if (opts?.offset !== undefined) q = q.offset(opts.offset);
	return q.execute();
}

/**
 * All active chain webhooks across every account — the input to the global
 * trigger evaluator (one loop serves them all). Subgraph webhooks are
 * excluded; they emit via the subgraph flush path.
 */
export async function listActiveChainWebhooks(
	db: Kysely<Database>,
): Promise<Webhook[]> {
	return db
		.selectFrom("webhooks")
		.selectAll()
		.where("kind", "=", "chain")
		.where("status", "=", "active")
		.execute();
}

export async function getWebhook(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<Webhook | null> {
	let q = db.selectFrom("webhooks").selectAll().where("id", "=", id);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	return (await q.executeTakeFirst()) ?? null;
}

export async function getWebhookByName(
	db: Kysely<Database>,
	accountId: string,
	name: string,
): Promise<Webhook | null> {
	let q = db.selectFrom("webhooks").selectAll().where("name", "=", name);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	return (await q.executeTakeFirst()) ?? null;
}

export interface UpdateWebhookInput {
	name?: string;
	filter?: unknown;
	format?: WebhookFormat;
	runtime?: WebhookRuntime | null;
	url?: string;
	authConfig?: unknown;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export async function updateWebhook(
	db: Kysely<Database>,
	accountId: string,
	id: string,
	patch: UpdateWebhookInput,
): Promise<Webhook | null> {
	const update: UpdateWebhook = { updated_at: new Date() };
	if (patch.name !== undefined) update.name = patch.name;
	if (patch.filter !== undefined) update.filter = patch.filter;
	if (patch.format !== undefined) update.format = patch.format;
	if (patch.runtime !== undefined) update.runtime = patch.runtime;
	if (patch.url !== undefined) update.url = patch.url;
	if (patch.authConfig !== undefined) update.auth_config = patch.authConfig;
	if (patch.maxRetries !== undefined) update.max_retries = patch.maxRetries;
	if (patch.timeoutMs !== undefined) update.timeout_ms = patch.timeoutMs;
	if (patch.concurrency !== undefined) update.concurrency = patch.concurrency;

	let q = db.updateTable("webhooks").set(update).where("id", "=", id);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	return (await q.returningAll().executeTakeFirst()) ?? null;
}

export async function toggleWebhookStatus(
	db: Kysely<Database>,
	accountId: string,
	id: string,
	status: WebhookStatus,
): Promise<Webhook | null> {
	let q = db
		.updateTable("webhooks")
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
		.where("id", "=", id);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	return (await q.returningAll().executeTakeFirst()) ?? null;
}

export async function deleteWebhook(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<boolean> {
	let q = db.deleteFrom("webhooks").where("id", "=", id);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	const res = await q.executeTakeFirst();
	return Number(res.numDeletedRows ?? 0) > 0;
}

export interface RotateSecretResult {
	webhook: Webhook;
	signingSecret: string;
}

export async function rotateWebhookSecret(
	db: Kysely<Database>,
	accountId: string,
	id: string,
): Promise<RotateSecretResult | null> {
	const signingSecret = generateSecret();
	let q = db
		.updateTable("webhooks")
		.set({
			signing_secret_enc: encryptSecret(signingSecret),
			updated_at: new Date(),
		})
		.where("id", "=", id);
	if (isPlatformMode()) q = q.where("account_id", "=", accountId);
	const row = await q.returningAll().executeTakeFirst();
	if (!row) return null;
	return { webhook: row, signingSecret };
}

/** Decrypt a webhook's signing secret for HMAC signing at emit time. */
export function getWebhookSigningSecret(webhook: Webhook): string {
	return decryptSecret(webhook.signing_secret_enc);
}

/** Fire `webhooks:changed` notify so the emitter hot-reloads its cache. */
export async function notifyWebhooksChanged(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	await sql`SELECT pg_notify('webhooks:changed', ${accountId})`.execute(db);
}
