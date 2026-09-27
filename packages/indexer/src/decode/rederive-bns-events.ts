/**
 * Bounded, one-time re-derivation of the BNS event logs (`bns_name_events`,
 * `bns_namespace_events`, `bns_marketplace_events`) for a block-height window —
 * the same pattern as `rederive-decoded-events.ts`: delete the window, then
 * re-decode it from the now-clean `events` firehose with the exact live
 * decode dispatch (`decodeBnsPrintEvent`).
 *
 * Run this AFTER a source repair (e.g. `repair-from-journal.ts`), never
 * before — a re-derive run first would wipe rows the source is temporarily
 * missing before the repair puts it back.
 *
 * Deliberately does NOT touch the `bns_names` / `bns_namespaces` projections:
 * those are forward-only state built by folding every event for a name in
 * order, and replaying only a bounded historical window through them risks
 * overwriting a name's CURRENT state with stale data if it was touched again
 * by a later event outside the window. If a window's projections also need
 * fixing, that is `handleBnsReorg`'s job (checkpoint rewind + full replay),
 * not this tool's.
 *
 * Dry-run by default; `--apply` deletes + writes, one transaction per window.
 * Keeps NO checkpoint of its own and never touches the live `decode.bns.v1`
 * checkpoint, so the live decoder stays at tip.
 *
 * Usage:
 *   bun run packages/indexer/src/decode/rederive-bns-events.ts --from-height 8964785 --to-height 8964808
 *   bun run packages/indexer/src/decode/rederive-bns-events.ts --from-height 8964785 --to-height 8964808 --apply
 */
import { decodeStreamsCursor } from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
import { readCanonicalStreamsEvents } from "../streams-events.ts";
import {
	type BnsMarketplaceEventRow,
	type BnsNameEventRow,
	type BnsNamespaceEventRow,
	writeBnsMarketplaceEvents,
	writeBnsNameEvents,
	writeBnsNamespaceEvents,
} from "./bns-storage.ts";
import {
	BNS_V2_MAINNET_CONTRACT,
	decodeBnsPrintEvent,
} from "./decoders/bns.ts";

const PAGE_LIMIT = 1000;

type Args = { fromHeight: number; toHeight: number; apply: boolean };

function parseArgs(argv: string[]): Args {
	let fromHeight: number | undefined;
	let toHeight: number | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--to-height") toHeight = Number(argv[++i]);
	}
	if (
		fromHeight === undefined ||
		toHeight === undefined ||
		!Number.isSafeInteger(fromHeight) ||
		!Number.isSafeInteger(toHeight) ||
		fromHeight > toHeight
	) {
		throw new Error("--from-height and --to-height (from <= to) are required");
	}
	return { fromHeight, toHeight, apply };
}

export async function rederiveBnsEvents(args: Args): Promise<{
	deletedNames: number;
	deletedNamespaces: number;
	deletedMarketplace: number;
	read: number;
	decoded: { names: number; namespaces: number; marketplace: number };
}> {
	const db = getSourceDb();
	let deletedNames = 0;
	let deletedNamespaces = 0;
	let deletedMarketplace = 0;
	if (args.apply) {
		const del = async (
			table:
				| "bns_name_events"
				| "bns_namespace_events"
				| "bns_marketplace_events",
		) => {
			const res = await sql`
				DELETE FROM ${sql.raw(table)}
				WHERE block_height >= ${args.fromHeight} AND block_height <= ${args.toHeight}
			`.execute(db);
			return Number(res.numAffectedRows ?? 0n);
		};
		deletedNames = await del("bns_name_events");
		deletedNamespaces = await del("bns_namespace_events");
		deletedMarketplace = await del("bns_marketplace_events");
	}

	let after: { block_height: number; event_index: number } | undefined;
	let read = 0;
	const decoded = { names: 0, namespaces: 0, marketplace: 0 };
	for (;;) {
		const page = await readCanonicalStreamsEvents({
			after,
			fromHeight: after ? undefined : args.fromHeight,
			toHeight: args.toHeight,
			types: ["print"],
			contractId: BNS_V2_MAINNET_CONTRACT,
			limit: PAGE_LIMIT,
			db,
		});
		read += page.events.length;

		const nameRows: BnsNameEventRow[] = [];
		const namespaceRows: BnsNamespaceEventRow[] = [];
		const marketplaceRows: BnsMarketplaceEventRow[] = [];
		for (const event of page.events as StreamsEvent[]) {
			try {
				const decodedEvent = decodeBnsPrintEvent(event);
				if (!decodedEvent) continue;
				if (decodedEvent.kind === "name") nameRows.push(decodedEvent.row);
				else if (decodedEvent.kind === "namespace")
					namespaceRows.push(decodedEvent.row);
				else marketplaceRows.push(decodedEvent.row);
			} catch (error) {
				logger.warn("rederive_bns.decode_skipped", {
					cursor: event.cursor,
					tx_id: event.tx_id,
					error: String(error),
				});
			}
		}
		decoded.names += nameRows.length;
		decoded.namespaces += namespaceRows.length;
		decoded.marketplace += marketplaceRows.length;

		if (args.apply) {
			if (nameRows.length > 0) await writeBnsNameEvents(nameRows, { db });
			if (namespaceRows.length > 0)
				await writeBnsNamespaceEvents(namespaceRows, { db });
			if (marketplaceRows.length > 0)
				await writeBnsMarketplaceEvents(marketplaceRows, { db });
		}

		if (!page.next_cursor) break;
		const next = decodeStreamsCursor(page.next_cursor);
		if (page.events.length === 0 && next.block_height >= args.toHeight) break;
		after = next;
	}

	return { deletedNames, deletedNamespaces, deletedMarketplace, read, decoded };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	console.log(
		`[rederive-bns-events] range [${args.fromHeight}, ${args.toHeight}] · ${args.apply ? "APPLY" : "dry-run"}`,
	);
	const result = await rederiveBnsEvents(args);
	console.log(
		`[rederive-bns-events] deleted names=${result.deletedNames} namespaces=${result.deletedNamespaces} marketplace=${result.deletedMarketplace} · read ${result.read} · decoded ${JSON.stringify(result.decoded)}${args.apply ? " (written)" : " (dry-run, nothing written)"}`,
	);
	console.log(
		"note: bns_names / bns_namespaces projections are not touched by this tool — see the file header.",
	);
	await closeDb();
}

if (import.meta.main) {
	void main();
}
