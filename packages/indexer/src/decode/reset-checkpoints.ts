/**
 * Ops tool: rewind classic decoder checkpoints to backfill history.
 *
 * The decoders that were added go-forward (stx/mints/burns/lock, print) only
 * hold data since their deploy. Rewinding a decoder's checkpoint makes it
 * replay from that point on its next poll — writes are idempotent upserts on
 * `cursor`, so re-processing the recent tail is harmless.
 *
 * The start cursor is the end of block H-1, so block H is decoded from its
 * first event (index 0). Height 0 clears the checkpoint (start from genesis).
 * Forward moves skip history and are refused without `--allow-forward`.
 *
 * Defaults to a ~90-day window and DRY-RUN. Run against the target DB
 * (prod env / indexer container) and pass `--apply` to actually write:
 *
 *   bun run src/decode/reset-checkpoints.ts                 # dry-run, 90d, go-forward decoders
 *   bun run src/decode/reset-checkpoints.ts --days 30       # dry-run, 30d
 *   bun run src/decode/reset-checkpoints.ts --from-height 8000000 --apply
 *   bun run src/decode/reset-checkpoints.ts --decoders decode.print.v1 --apply
 *
 * After --apply, decoders pick up the new checkpoint within a poll cycle;
 * restart the indexer to force immediate pickup. Reset one group at a time to
 * avoid overloading the Streams API / DB.
 */
import {
	blockEndCursor,
	compareStreamsCursor,
	decodeStreamsCursor,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	DECODER_NAMES,
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecoderCheckpoint,
} from "./storage.ts";

// ft/nft transfers were the original decoders and already hold full history;
// the backfill targets the types added go-forward.
const GO_FORWARD_DECODERS = DECODER_NAMES.filter(
	(name) =>
		name !== FT_TRANSFER_DECODER_NAME && name !== NFT_TRANSFER_DECODER_NAME,
);

const SECONDS_PER_DAY = 86_400;

type Args = {
	days: number;
	fromHeight?: number;
	decoders: readonly string[];
	apply: boolean;
	allowForward: boolean;
};

export function parseArgs(argv: string[]): Args {
	let days = 90;
	let fromHeight: number | undefined;
	let decoders: readonly string[] = GO_FORWARD_DECODERS;
	let apply = false;
	let allowForward = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--allow-forward") allowForward = true;
		else if (arg === "--days") days = Number(argv[++i]);
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--decoders") {
			decoders = (argv[++i] ?? "").split(",").filter(Boolean);
		} else throw new Error(`unknown flag: ${arg}`);
	}

	if (!Number.isFinite(days) || days <= 0) {
		throw new Error("--days must be a positive number");
	}
	if (fromHeight !== undefined && !Number.isSafeInteger(fromHeight)) {
		throw new Error("--from-height must be an integer");
	}
	const unknown = decoders.filter(
		(name) => !DECODER_NAMES.includes(name as never),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown decoders: ${unknown.join(", ")}`);
	}
	return { days, fromHeight, decoders, apply, allowForward };
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

/** Checkpoint meaning "everything before block `height` is decoded". */
export function startCursorForHeight(height: number): string | null {
	return height <= 0 ? null : encodeStreamsCursor(blockEndCursor(height - 1));
}

export type ResetPlanRow = {
	decoderName: string;
	current: string | null;
	next: string | null;
	direction: "backward" | "same" | "forward";
};

export function planReset(input: {
	startHeight: number;
	current: Record<string, string | null>;
	decoders: readonly string[];
}): ResetPlanRow[] {
	const next = startCursorForHeight(input.startHeight);
	return input.decoders.map((decoderName) => {
		const current = input.current[decoderName] ?? null;
		let direction: ResetPlanRow["direction"];
		if (current === next) direction = "same";
		else if (next === null) direction = "backward";
		else if (current === null) direction = "forward";
		else {
			direction =
				compareStreamsCursor(
					decodeStreamsCursor(next),
					decodeStreamsCursor(current),
				) > 0
					? "forward"
					: "backward";
		}
		return { decoderName, current, next, direction };
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	const startHeight = await resolveStartHeight(db, args);

	console.log(
		`[reset-checkpoints] start height ${startHeight} (${
			args.fromHeight !== undefined ? "explicit" : `~${args.days}d window`
		}) · ${args.decoders.length} decoders · ${
			args.apply ? "APPLY" : "dry-run"
		}`,
	);

	const current: Record<string, string | null> = {};
	for (const name of args.decoders) {
		current[name] = await readDecoderCheckpoint({ db, decoderName: name });
	}
	const plan = planReset({ startHeight, current, decoders: args.decoders });
	for (const row of plan) {
		console.log(
			`  ${row.decoderName}: ${row.current ?? "(none)"} -> ${row.next ?? "(genesis)"} [${row.direction}]`,
		);
	}

	const forward = plan.filter((row) => row.direction === "forward");
	if (forward.length > 0 && !args.allowForward) {
		throw new Error(
			`${forward.map((row) => row.decoderName).join(", ")}: refusing to move a checkpoint forward (that skips history); pass --allow-forward if intended`,
		);
	}

	if (args.apply) {
		for (const row of plan) {
			if (row.direction === "same") continue;
			await writeDecoderCheckpoint({
				db,
				decoderName: row.decoderName,
				cursor: row.next,
			});
		}
	}

	console.log(
		args.apply
			? "[reset-checkpoints] applied — decoders replay on next poll (restart indexer to force immediate pickup)"
			: "[reset-checkpoints] dry-run only — re-run with --apply to write",
	);

	await closeDb();
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(error instanceof Error ? error.message : error);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
