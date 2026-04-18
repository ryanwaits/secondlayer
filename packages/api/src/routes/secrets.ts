import { encryptSecret } from "@secondlayer/shared/crypto/secrets";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { z } from "zod";
import { getAccountId } from "../lib/ownership.ts";

/**
 * Workflow signer secrets — per-account HMAC shared secrets used by the
 * runner to authenticate requests to customer-hosted remote signer
 * endpoints. Values are AES-GCM encrypted at rest. This surface supports
 * rotation without workflow redeployment.
 *
 * Routes:
 *   GET    /api/secrets           → list names (never returns values)
 *   PUT    /api/secrets/:name     → set or rotate a secret
 *   DELETE /api/secrets/:name     → delete a secret
 */
const secretsRouter = new Hono();

const NameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z][a-z0-9-]*$/, {
		message:
			"Secret name must be lowercase alphanumeric with hyphens (start with letter)",
	});

const SetBodySchema = z.object({ value: z.string().min(1).max(4096) });

secretsRouter.get("/", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "unauthenticated" }, 401);
	const db = getDb();
	const rows = await db
		.selectFrom("workflow_signer_secrets")
		.select(["name", "created_at", "updated_at"])
		.where("account_id", "=", accountId)
		.orderBy("name", "asc")
		.execute();
	return c.json({
		secrets: rows.map((r) => ({
			name: r.name,
			createdAt: r.created_at.toISOString(),
			updatedAt: r.updated_at.toISOString(),
		})),
	});
});

secretsRouter.put("/:name", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "unauthenticated" }, 401);
	const nameParsed = NameSchema.safeParse(c.req.param("name"));
	if (!nameParsed.success) {
		return c.json({ error: nameParsed.error.issues[0]?.message }, 400);
	}
	const bodyRaw = await c.req.json().catch(() => null);
	const bodyParsed = SetBodySchema.safeParse(bodyRaw);
	if (!bodyParsed.success) {
		return c.json({ error: bodyParsed.error.issues[0]?.message }, 400);
	}
	const db = getDb();
	const ciphertext = encryptSecret(bodyParsed.data.value);
	const now = new Date();

	await db
		.insertInto("workflow_signer_secrets")
		.values({
			account_id: accountId,
			name: nameParsed.data,
			encrypted_value: ciphertext,
			created_at: now,
			updated_at: now,
		})
		.onConflict((oc) =>
			oc.columns(["account_id", "name"]).doUpdateSet({
				encrypted_value: ciphertext,
				updated_at: now,
			}),
		)
		.execute();

	return c.json({ ok: true, name: nameParsed.data });
});

secretsRouter.delete("/:name", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "unauthenticated" }, 401);
	const nameParsed = NameSchema.safeParse(c.req.param("name"));
	if (!nameParsed.success) {
		return c.json({ error: nameParsed.error.issues[0]?.message }, 400);
	}
	const db = getDb();
	const result = await db
		.deleteFrom("workflow_signer_secrets")
		.where("account_id", "=", accountId)
		.where("name", "=", nameParsed.data)
		.executeTakeFirst();

	if ((result.numDeletedRows ?? 0n) === 0n) {
		return c.json({ error: "secret not found" }, 404);
	}
	return c.json({ ok: true });
});

export { secretsRouter };
