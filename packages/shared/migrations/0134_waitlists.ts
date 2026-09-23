import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Public waitlists. `waitlists` says what each list is for and whether it
 * is open; `waitlist_signups` holds one row per (list, contact, token).
 *
 * `contact` is free text (Telegram, X handle, or email) because token
 * communities live on Telegram, not in inboxes. `answers` holds the
 * per-list questions (the bridge list asks role, token, contract, note);
 * the API validates them per list before insert. Opening or closing an
 * existing list is a `closed_at` update, not a deploy. Control plane,
 * next to `accounts`; nothing here is an account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE waitlists (
				slug        text PRIMARY KEY,
				title       text NOT NULL,
				description text NOT NULL,
				url         text NOT NULL,
				opened_at   timestamptz NOT NULL DEFAULT now(),
				closed_at   timestamptz
			)
		`.execute(db);

		await sql`
			CREATE TABLE waitlist_signups (
				id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				list       text NOT NULL REFERENCES waitlists(slug),
				contact    text NOT NULL,
				answers    jsonb NOT NULL DEFAULT '{}'::jsonb,
				created_at timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		// A repeat submit from the same person for the same token is a no-op.
		// Lists without a token answer dedupe on contact alone.
		await sql`
			CREATE UNIQUE INDEX waitlist_signups_list_contact_token_key
				ON waitlist_signups (list, lower(contact), lower(coalesce(answers->>'token', '')))
		`.execute(db);

		await sql`
			INSERT INTO waitlists (slug, title, description, url)
			VALUES (
				'robinhood',
				'Stacks to Robinhood Chain',
				'SIP-010 tokens that want to bridge Stacks to Robinhood Chain (chain 4663) and back; picks the first tokens for phase 1 testing.',
				'https://www.secondlayer.tools/robinhood'
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS waitlist_signups`.execute(db);
		await sql`DROP TABLE IF EXISTS waitlists`.execute(db);
	});
}
