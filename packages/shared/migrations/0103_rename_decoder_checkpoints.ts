import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Drop the legacy `l2` (layer-2) naming off the decode plane (ADR-0010).
 *
 * `l2` collides with the blockchain layer model (Bitcoin = L1, Stacks = L2), so
 * an "L2 decoder" reads as a chain layer rather than our decode plane. Two
 * in-place renames on the SOURCE (chain) plane:
 *   1. table  `l2_decoder_checkpoints` → `decoder_checkpoints`
 *   2. values `decoder_name` `l2.*`   → `decode.*`
 *
 * The value re-key is what keeps this non-destructive: the decoder code now reads
 * checkpoints under `decode.<event_type>.vN`, so without re-keying it would find
 * no row and re-decode every event from genesis. Re-keying in place preserves
 * each decoder's saved cursor — zero re-decode. `migrate` runs before the decoder
 * service boots (compose `depends_on`), so the new names exist before first read.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE IF EXISTS l2_decoder_checkpoints RENAME TO decoder_checkpoints`.execute(
			db,
		);
		await sql`UPDATE decoder_checkpoints SET decoder_name = 'decode.' || substring(decoder_name from 4) WHERE decoder_name LIKE 'l2.%'`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`UPDATE decoder_checkpoints SET decoder_name = 'l2.' || substring(decoder_name from 8) WHERE decoder_name LIKE 'decode.%'`.execute(
			db,
		);
		await sql`ALTER TABLE IF EXISTS decoder_checkpoints RENAME TO l2_decoder_checkpoints`.execute(
			db,
		);
	});
}
