import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getDb } from "./index.ts";

const SKIP = !process.env.DATABASE_URL;

/** Run `statement` in a transaction that always rolls back; return the error text. */
async function rejection(
	statement: (trx: ReturnType<typeof getDb>) => Promise<unknown>,
): Promise<string | null> {
	let message: string | null = null;
	await getDb()
		.transaction()
		.execute(async (trx) => {
			try {
				await statement(trx as unknown as ReturnType<typeof getDb>);
			} catch (error) {
				message = String(error instanceof Error ? error.message : error);
			}
			throw new Error("rollback");
		})
		.catch(() => {});
	return message;
}

describe.skipIf(SKIP)("status CHECK constraints", () => {
	test("contracts rejects an unknown abi_status", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO contracts (contract_id, deployer, block_height, abi_status)
				VALUES ('SP000.bad-abi-status', 'SP000', 1, 'bogus')
			`.execute(trx),
		);
		expect(error).toContain("contracts_abi_status_check");
	});

	test("contracts accepts every AbiStatus", async () => {
		for (const status of ["pending", "fetched", "unparseable", "failed"]) {
			const error = await rejection((trx) =>
				sql`
					INSERT INTO contracts (contract_id, deployer, block_height, abi_status)
					VALUES ('SP000.ok-abi-status', 'SP000', 1, ${status})
				`.execute(trx),
			);
			expect(error).toBeNull();
		}
	});

	test("webhook_outbox rejects an unknown status", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO webhook_outbox
					(webhook_id, kind, block_height, row_pk, event_type, payload, dedup_key, status)
				VALUES (${crypto.randomUUID()}, 'chain', 1, '{}', 'x', '{}', ${crypto.randomUUID()}, 'bogus')
			`.execute(trx),
		);
		expect(error).toContain("webhook_outbox_status_check");
	});

	test("api_keys rejects an unknown status", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO api_keys (key_hash, key_prefix, ip_address, account_id, status)
				VALUES ('h', 'p', '127.0.0.1', ${crypto.randomUUID()}, 'bogus')
			`.execute(trx),
		);
		expect(error).toContain("api_keys_status_check");
	});

	test("api_keys rejects a revoked key without revoked_at", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO api_keys (key_hash, key_prefix, ip_address, account_id, status)
				VALUES ('h', 'p', '127.0.0.1', ${crypto.randomUUID()}, 'revoked')
			`.execute(trx),
		);
		expect(error).toContain("api_keys_revoked_at_check");
	});

	test("api_keys rejects an active key that has revoked_at", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO api_keys (key_hash, key_prefix, ip_address, account_id, status, revoked_at)
				VALUES ('h', 'p', '127.0.0.1', ${crypto.randomUUID()}, 'active', now())
			`.execute(trx),
		);
		expect(error).toContain("api_keys_revoked_at_check");
	});

	test("subgraph_gaps rejects an unknown reason", async () => {
		const error = await rejection(async (trx) => {
			const { rows } = await sql<{ id: string }>`
				INSERT INTO subgraphs (name, definition, schema_hash, handler_path, account_id)
				VALUES ('gap-check', '{}', 'h', '/tmp/h.ts', ${crypto.randomUUID()})
				RETURNING id
			`.execute(trx);
			await sql`
				INSERT INTO subgraph_gaps (subgraph_id, subgraph_name, gap_start, gap_end, reason)
				VALUES (${rows[0]?.id}, 'gap-check', 1, 2, 'bogus')
			`.execute(trx);
		});
		expect(error).toContain("subgraph_gaps_reason_check");
	});

	test("accounts rejects a ghost that has an email", async () => {
		const error = await rejection((trx) =>
			sql`
				INSERT INTO accounts (email, ghost)
				VALUES ('ghost-with-email@example.com', true)
			`.execute(trx),
		);
		expect(error).toContain("accounts_ghost_no_email_check");
	});

	test("accounts accepts a ghost without an email and a non-ghost with one", async () => {
		const error = await rejection(async (trx) => {
			await sql`INSERT INTO accounts (email, ghost) VALUES (NULL, true)`.execute(
				trx,
			);
			await sql`
				INSERT INTO accounts (email, ghost)
				VALUES ('not-a-ghost@example.com', false)
			`.execute(trx);
		});
		expect(error).toBeNull();
	});
});
