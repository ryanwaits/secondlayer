#!/usr/bin/env bun
/**
 * Read-only fingerprint of every print row's served payload.
 *
 * Reads `cursor, payload, raw_value` of the print rows at the given heights
 * from one table and writes `cursor<TAB>sha256` of the JSON the API would
 * serve (`printPayloadFromStored`). `--out` saves the lines; `--compare`
 * checks them against a saved file and prints `N diverging` (exit 1 when
 * N > 0). Run it on `decoded_events` before a layout rewrite, on
 * `decoded_events_next` after the copy, and on `decoded_events` after the
 * swap: all three must agree.
 *
 * Usage:
 *   bun run packages/indexer/src/print-payload-golden.ts --table decoded_events --heights 17695-20000,9590000 --out before.tsv
 *   bun run packages/indexer/src/print-payload-golden.ts --table decoded_events_next --heights 17695-20000,9590000 --compare before.tsv
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { printPayloadFromStored } from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";

export const GOLDEN_TABLES = ["decoded_events", "decoded_events_next"] as const;
export type GoldenTable = (typeof GOLDEN_TABLES)[number];

const HEIGHTS_PER_QUERY = 500;

type GoldenArgs = {
	table: GoldenTable;
	heights: number[];
	out?: string;
	compare?: string;
};

type GoldenRow = {
	cursor: string;
	payload: unknown;
	raw_value: Uint8Array | null;
};

export function parseHeights(spec: string): number[] {
	const heights = new Set<number>();
	for (const token of spec.split(",")) {
		const [from, to] = token
			.trim()
			.split("-")
			.map((part) => Number(part));
		const last = to ?? from;
		if (
			from === undefined ||
			!Number.isSafeInteger(from) ||
			!Number.isSafeInteger(last) ||
			from < 0 ||
			from > last
		) {
			throw new Error(`invalid heights token: "${token}"`);
		}
		for (let height = from; height <= last; height++) heights.add(height);
	}
	return [...heights].sort((a, b) => a - b);
}

export function parseArgs(argv: string[]): GoldenArgs {
	let table: string | undefined;
	let heights: string | undefined;
	let out: string | undefined;
	let compare: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--table") table = argv[++i];
		else if (arg === "--heights") heights = argv[++i];
		else if (arg === "--out") out = argv[++i];
		else if (arg === "--compare") compare = argv[++i];
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!table || !(GOLDEN_TABLES as readonly string[]).includes(table)) {
		throw new Error(`--table must be one of: ${GOLDEN_TABLES.join(", ")}`);
	}
	if (!heights) throw new Error("--heights is required");
	return {
		table: table as GoldenTable,
		heights: parseHeights(heights),
		out,
		compare,
	};
}

export function goldenLine(row: GoldenRow): string {
	const served = JSON.stringify(printPayloadFromStored(row));
	return `${row.cursor}\t${createHash("sha256").update(served).digest("hex")}`;
}

export async function* goldenLines(
	db: Kysely<unknown>,
	table: GoldenTable,
	heights: readonly number[],
): AsyncGenerator<string> {
	for (let i = 0; i < heights.length; i += HEIGHTS_PER_QUERY) {
		const chunk = heights.slice(i, i + HEIGHTS_PER_QUERY);
		const { rows } = await sql<GoldenRow>`
			SELECT cursor, payload, raw_value
			  FROM ${sql.table(table)}
			 WHERE event_type = 'print'
			   AND block_height = ANY(ARRAY[${sql.join(chunk)}]::bigint[])
			 ORDER BY cursor
		`.execute(db);
		for (const row of rows) yield goldenLine(row);
	}
}

export function parseGoldenFile(text: string): Map<string, string> {
	const expected = new Map<string, string>();
	for (const line of text.split("\n")) {
		if (!line) continue;
		const [cursor, hash] = line.split("\t");
		if (cursor && hash) expected.set(cursor, hash);
	}
	return expected;
}

export async function countDiverging(
	lines: AsyncIterable<string>,
	expected: Map<string, string>,
): Promise<number> {
	const seen = new Set<string>();
	let diverging = 0;
	for await (const line of lines) {
		const [cursor, hash] = line.split("\t");
		if (!cursor) continue;
		seen.add(cursor);
		if (expected.get(cursor) !== hash) diverging++;
	}
	for (const cursor of expected.keys()) if (!seen.has(cursor)) diverging++;
	return diverging;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb() as unknown as Kysely<unknown>;
	const lines = goldenLines(db, args.table, args.heights);
	let code = 0;
	if (args.compare) {
		const expected = parseGoldenFile(await readFile(args.compare, "utf8"));
		const diverging = await countDiverging(lines, expected);
		console.log(`${diverging} diverging of ${expected.size} compared`);
		if (diverging > 0) code = 1;
	} else {
		const collected: string[] = [];
		for await (const line of lines) collected.push(line);
		const text = `${collected.join("\n")}\n`;
		if (args.out) await writeFile(args.out, text);
		else process.stdout.write(text);
		console.error(`${collected.length} print rows fingerprinted`);
	}
	await closeDb();
	return code;
}

if (import.meta.main) {
	main()
		.then((code) => process.exit(code))
		.catch(async (err) => {
			console.error(
				"print-payload-golden failed:",
				err instanceof Error ? (err.stack ?? err.message) : err,
			);
			await closeDb().catch(() => {});
			process.exit(1);
		});
}
