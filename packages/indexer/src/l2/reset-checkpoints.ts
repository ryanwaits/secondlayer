/**
 * Ops tool: rewind L2 decoder checkpoints to backfill history.
 *
 * The decoders that were added go-forward (stx/mints/burns/lock, print) only
 * hold data since their deploy. Rewinding a decoder's checkpoint makes it
 * replay from that point on its next poll — writes are idempotent upserts on
 * `cursor`, so re-processing the recent tail is harmless.
 *
 * Defaults to a ~90-day window and DRY-RUN. Run against the target DB
 * (prod env / indexer container) and pass `--apply` to actually write:
 *
 *   bun run src/l2/reset-checkpoints.ts                 # dry-run, 90d, go-forward decoders
 *   bun run src/l2/reset-checkpoints.ts --days 30       # dry-run, 30d
 *   bun run src/l2/reset-checkpoints.ts --from-height 8000000 --apply
 *   bun run src/l2/reset-checkpoints.ts --decoders l2.print.v1 --apply
 *
 * After --apply, decoders pick up the new checkpoint within a poll cycle;
 * restart the indexer to force immediate pickup. Reset one group at a time to
 * avoid overloading the Streams API / DB.
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	FT_TRANSFER_DECODER_NAME,
	L2_DECODER_NAMES,
	NFT_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecoderCheckpoint,
} from "./storage.ts";

// ft/nft transfers were the original decoders and already hold full history;
// the backfill targets the types added go-forward.
const GO_FORWARD_DECODERS = L2_DECODER_NAMES.filter(
	(name) =>
		name !== FT_TRANSFER_DECODER_NAME && name !== NFT_TRANSFER_DECODER_NAME,
);

const SECONDS_PER_DAY = 86_400;

type Args = {
	days: number;
	fromHeight?: number;
	decoders: readonly string[];
	apply: boolean;
};

function parseArgs(argv: string[]): Args {
	let days = 90;
	let fromHeight: number | undefined;
	let decoders: readonly string[] = GO_FORWARD_DECODERS;
	let apply = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--days") days = Number(argv[++i]);
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--decoders") {
			decoders = (argv[++i] ?? "").split(",").filter(Boolean);
		}
	}

	if (!Number.isFinite(days) || days <= 0) {
		throw new Error("--days must be a positive number");
	}
	if (fromHeight !== undefined && !Number.isSafeInteger(fromHeight)) {
		throw new Error("--from-height must be an integer");
	}
	const unknown = decoders.filter(
		(name) => !L2_DECODER_NAMES.includes(name as never),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown decoders: ${unknown.join(", ")}`);
	}
	return { days, fromHeight, decoders, apply };
}

async function resolveStartHeight(
	db: Kysely<Database>,
	args: Args,
): Promise<number> {
	if (args.fromHeight !== undefined) return args.fromHeight;
	const cutoff = Math.floor(Date.now() / 1000) - args.days * SECONDS_PER_DAY;
	const { rows } = await sql<{ h: string | number | null }>`
		SELECT MIN(height) AS h
		FROM blocks
		WHERE canonical = true AND timestamp >= ${cutoff}
	`.execute(db);
	const h = rows[0]?.h;
	return h === null || h === undefined ? 0 : Number(h);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	const startHeight = await resolveStartHeight(db, args);
	const cursor = `${startHeight}:0`;

	console.log(
		`[reset-checkpoints] start cursor ${cursor} (${
			args.fromHeight !== undefined ? "explicit" : `~${args.days}d window`
		}) · ${args.decoders.length} decoders · ${
			args.apply ? "APPLY" : "dry-run"
		}`,
	);

	for (const name of args.decoders) {
		const current = await readDecoderCheckpoint({ db, decoderName: name });
		console.log(`  ${name}: ${current ?? "(none)"} -> ${cursor}`);
		if (args.apply) {
			await writeDecoderCheckpoint({ db, decoderName: name, cursor });
		}
	}

	console.log(
		args.apply
			? "[reset-checkpoints] applied — decoders replay on next poll (restart indexer to force immediate pickup)"
			: "[reset-checkpoints] dry-run only — re-run with --apply to write",
	);

	await closeDb();
}

void main();
