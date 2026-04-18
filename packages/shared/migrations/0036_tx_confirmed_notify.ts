import { type Kysely, sql } from "kysely";

/**
 * pg_notify trigger on the core `transactions` table. Fires on INSERT and
 * publishes the txid on the `tx:confirmed` channel. The workflow runner's
 * `confirmation/subgraph.ts` listens on this channel to resolve pending
 * `broadcast({ awaitConfirmation: true })` promises.
 *
 * Payload is just the tx_id — listeners dedupe + look up details
 * themselves. Keeping the payload small keeps pg_notify throughput high.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
    CREATE OR REPLACE FUNCTION notify_tx_confirmed() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('tx:confirmed', NEW.tx_id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

	await sql`
    DROP TRIGGER IF EXISTS tx_confirmed_notify ON transactions;
    CREATE TRIGGER tx_confirmed_notify
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION notify_tx_confirmed();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TRIGGER IF EXISTS tx_confirmed_notify ON transactions`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS notify_tx_confirmed()`.execute(db);
}
