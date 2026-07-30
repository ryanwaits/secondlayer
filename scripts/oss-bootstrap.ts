#!/usr/bin/env bun
/**
 * OSS bootstrap — provision the local owner account and print its API key.
 *
 * A self-hosted instance has no signup flow: magic-link login needs an email
 * provider, and the accountless deploy path is gated on the x402 rail nobody
 * runs at home. Without this, `sl subgraphs deploy` against your own stack
 * dead-ends at "claim an account", which is meaningless on a single-tenant box
 * you already own.
 *
 * Idempotent: re-running reuses the existing local account and mints a fresh
 * key (the previous one keeps working until you revoke it).
 *
 *   docker compose run --rm api bun run scripts/oss-bootstrap.ts
 *
 * The key is printed ONCE — only its hash is stored.
 */
import { closeDb, getDb } from "@secondlayer/shared/db";
import { mintApiKey } from "../packages/api/src/auth/mint.ts";

const LOCAL_ACCOUNT_EMAIL = "owner@localhost";

async function main() {
	const db = getDb();

	const existing = await db
		.selectFrom("accounts")
		.select(["id", "plan"])
		.where("email", "=", LOCAL_ACCOUNT_EMAIL)
		.executeTakeFirst();

	const account =
		existing ??
		(await db
			.insertInto("accounts")
			.values({
				email: LOCAL_ACCOUNT_EMAIL,
				ghost: false,
				display_name: "Self-hosted owner",
				// Self-host is unmetered: plan gates exist to bill hosted tenants,
				// and on your own hardware they should never say "upgrade".
				plan: "enterprise",
			})
			.returning(["id", "plan"])
			.executeTakeFirstOrThrow());

	const minted = await mintApiKey(db, {
		accountId: account.id,
		name: "self-host owner key",
		product: "account",
		tier: "enterprise",
		ip: "127.0.0.1",
	});

	console.log(`
Local owner account ${existing ? "reused" : "created"}: ${account.id}

  API key (shown once — only its hash is stored):

    ${minted.key}

  Use it with the CLI:

    export SL_API_KEY=${minted.key}
    export SL_API_URL=http://localhost:3800
    sl subgraphs deploy ./subgraph.config.ts

  Or directly:

    curl -H "Authorization: Bearer ${minted.key}" http://localhost:3800/api/subgraphs
`);

	await closeDb();
}

main().catch(async (err) => {
	console.error("oss-bootstrap failed:", err);
	await closeDb().catch(() => {});
	process.exit(1);
});
