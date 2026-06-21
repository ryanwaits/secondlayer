/**
 * Floor-regression guard for the decode service.
 *
 * `health.ts` proves each decoder is caught up to TIP. This proves each decoder
 * is complete down to GENESIS — the other half of the index service's contract
 * ("every block from genesis, decoded + supplied"). The two are independent: a
 * decoder can sit exactly at tip while serving zero history below some floor,
 * which is precisely the defect Sprint A/B fixed — 7 generic decoders were added
 * go-forward and never backfilled, so `decoded_events` was floored at ~6.8M for
 * them while every health check stayed green.
 *
 * The guard compares each enabled decoder's live floor (min canonical
 * block_height) against a recorded known-good baseline. A floor ABOVE
 * baseline+tolerance means history went missing (or a new decoder shipped
 * without a genesis backfill). A new enabled decoder with NO baseline entry also
 * fails — the forcing function: adding a decoder makes you record its genesis
 * floor here, which is impossible to do honestly without first backfilling it.
 *
 * Intentionally NOT wired into the per-request /public/status path — it adds a
 * min() scan per decoder. Run it as a CI / cron / on-demand check
 * (`bun run src/decode/floor-audit.ts`), not on every health poll.
 */
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { BNS_DECODER_NAME } from "./bns-storage.ts";
import { POX4_DECODER_NAME } from "./pox4-storage.ts";
import { SBTC_DECODER_NAME, SBTC_TOKEN_DECODER_NAME } from "./sbtc-storage.ts";
import {
	DECODER_EVENT_TYPES,
	type DecoderName,
	getEnabledDecoderNames,
} from "./storage.ts";

/**
 * Known-good genesis floor (min canonical block_height) per decoder, captured
 * from prod 2026-06-21 right after the Sprint B genesis backfill completed.
 *
 * Generic value/asset decoders floor near block 1 — these event types exist
 * since chain genesis. Dedicated contract decoders floor at their contract's
 * deploy height (sBTC ~328k, pox-4 ~147k, BNS-v2 ~167k), NOT block 1 — which is
 * why this is a per-decoder map and not a blanket "must be < N" threshold.
 *
 * Adding a decoder? Backfill it to genesis first, then record its measured floor
 * here. The audit fails on any enabled decoder missing from this map.
 */
export const DECODER_FLOOR_BASELINE: Record<string, number> = {
	"decode.ft_transfer.v1": 4846,
	"decode.ft_mint.v1": 4763,
	"decode.ft_burn.v1": 8069,
	"decode.nft_transfer.v1": 2058,
	"decode.nft_mint.v1": 1675,
	"decode.nft_burn.v1": 26669,
	"decode.stx_transfer.v1": 10,
	"decode.stx_mint.v1": 1,
	"decode.stx_burn.v1": 2855,
	"decode.stx_lock.v1": 9,
	"decode.print.v1": 32,
	"decode.sbtc.v1": 328312,
	"decode.sbtc_token.v1": 329351,
	"decode.pox4.v1": 147294,
	"decode.bns.v1": 167540,
};

/**
 * Slack above baseline before a floor counts as regressed. Absorbs a near-floor
 * reorg shifting the first canonical event by a few blocks. Two orders of
 * magnitude below the ~6.8M regression Sprint A/B fixed, so a truly floored
 * decoder still trips well clear of the noise.
 */
export const FLOOR_TOLERANCE = 50_000;

export type FloorStatus = "ok" | "floored" | "unbaselined" | "empty";

export type DecoderFloor = {
	decoder: string;
	/** min canonical block_height, or null if the decoder has written no rows. */
	floor: number | null;
	/** recorded known-good floor, or null if this decoder has no baseline. */
	baseline: number | null;
	/** baseline + tolerance; floors above this are regressions. */
	ceiling: number | null;
	status: FloorStatus;
};

export type FloorAudit = {
	ok: boolean;
	decoders: DecoderFloor[];
	/** floor above ceiling — history went missing. */
	floored: DecoderFloor[];
	/** enabled decoder with no baseline entry — add one (after backfilling). */
	unbaselined: DecoderFloor[];
};

/**
 * Pure floor-comparison logic — no DB. Given each enabled decoder's measured
 * floor, classify it against the baseline. `ok` is false if anything is floored
 * or unbaselined; an empty decoder (no rows yet) is informational, not a failure.
 */
export function auditFloors(
	floors: ReadonlyArray<{ decoder: string; floor: number | null }>,
	opts?: { baseline?: Record<string, number>; tolerance?: number },
): FloorAudit {
	const baselineMap = opts?.baseline ?? DECODER_FLOOR_BASELINE;
	const tolerance = opts?.tolerance ?? FLOOR_TOLERANCE;

	const decoders = floors.map(({ decoder, floor }): DecoderFloor => {
		const baseline = baselineMap[decoder];
		if (baseline === undefined) {
			return {
				decoder,
				floor,
				baseline: null,
				ceiling: null,
				status: "unbaselined",
			};
		}
		const ceiling = baseline + tolerance;
		const status: FloorStatus =
			floor === null ? "empty" : floor > ceiling ? "floored" : "ok";
		return { decoder, floor, baseline, ceiling, status };
	});

	const floored = decoders.filter((d) => d.status === "floored");
	const unbaselined = decoders.filter((d) => d.status === "unbaselined");
	return {
		ok: floored.length === 0 && unbaselined.length === 0,
		decoders,
		floored,
		unbaselined,
	};
}

/**
 * Min canonical block_height for one decoder. Dedicated decoders read their own
 * table; the rest read `decoded_events` filtered by event_type. The
 * event_type + canonical filter hits the partial index
 * `decoded_events_type_height_event_idx (event_type, block_height) WHERE
 * canonical`, so this stays an index seek even on the 24M+ row table — without
 * the canonical predicate it degrades to a scan and times out.
 */
async function readDecoderFloor(
	db: Kysely<Database>,
	decoderName: string,
): Promise<number | null> {
	const minOf = async (
		// biome-ignore lint/suspicious/noExplicitAny: dedicated tables vary; the query shape is identical.
		table: any,
	): Promise<number | null> => {
		const row = await db
			.selectFrom(table)
			.select((eb) => eb.fn.min("block_height").as("floor"))
			.where("canonical", "=", true)
			.executeTakeFirst();
		return row?.floor == null ? null : Number(row.floor);
	};

	if (decoderName === SBTC_DECODER_NAME) return minOf("sbtc_events");
	if (decoderName === SBTC_TOKEN_DECODER_NAME)
		return minOf("sbtc_token_events");
	if (decoderName === POX4_DECODER_NAME) return minOf("pox4_calls");
	if (decoderName === BNS_DECODER_NAME) return minOf("bns_name_events");

	const eventType =
		DECODER_EVENT_TYPES[decoderName as DecoderName] ?? decoderName;
	const row = await db
		.selectFrom("decoded_events")
		.select((eb) => eb.fn.min("block_height").as("floor"))
		.where("event_type", "=", eventType)
		.where("canonical", "=", true)
		.executeTakeFirst();
	return row?.floor == null ? null : Number(row.floor);
}

/** Read the live floor for every enabled decoder. */
export async function readDecoderFloors(opts?: {
	db?: Kysely<Database>;
	decoderNames?: readonly string[];
}): Promise<Array<{ decoder: string; floor: number | null }>> {
	const db = opts?.db ?? getSourceDb();
	const decoderNames = opts?.decoderNames ?? getEnabledDecoderNames();
	return Promise.all(
		decoderNames.map(async (decoder) => ({
			decoder,
			floor: await readDecoderFloor(db, decoder),
		})),
	);
}

/** Read live floors and audit them against the baseline in one call. */
export async function runFloorAudit(opts?: {
	db?: Kysely<Database>;
	decoderNames?: readonly string[];
	baseline?: Record<string, number>;
	tolerance?: number;
}): Promise<FloorAudit> {
	const floors = await readDecoderFloors(opts);
	return auditFloors(floors, opts);
}

function formatReport(audit: FloorAudit): string {
	const lines = audit.decoders.map((d) => {
		const floor = d.floor ?? "—";
		const ceil = d.ceiling ?? "—";
		const mark = d.status === "ok" ? "✓" : d.status === "empty" ? "·" : "✗";
		return `  ${mark} ${d.decoder.padEnd(24)} floor=${String(floor).padStart(9)}  baseline=${String(d.baseline ?? "—").padStart(9)}  ceiling=${ceil}  [${d.status}]`;
	});
	return lines.join("\n");
}

if (import.meta.main) {
	const audit = await runFloorAudit();
	process.stdout.write(`Decoder floor audit:\n${formatReport(audit)}\n`);
	if (!audit.ok) {
		if (audit.floored.length)
			process.stderr.write(
				`\nFLOORED (history missing below baseline): ${audit.floored.map((d) => d.decoder).join(", ")}\n`,
			);
		if (audit.unbaselined.length)
			process.stderr.write(
				`\nUNBASELINED (add to DECODER_FLOOR_BASELINE after genesis backfill): ${audit.unbaselined.map((d) => d.decoder).join(", ")}\n`,
			);
		process.exit(1);
	}
	process.stdout.write("\nAll decoders genesis-complete.\n");
}
