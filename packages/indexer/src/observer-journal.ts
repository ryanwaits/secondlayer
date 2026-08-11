import { createHash } from "node:crypto";
import type { Database, ObserverJournalStatus } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

export type ObserverPath = "/new_block" | "/new_burn_block";

export interface ObserverReceipt {
	sequence: string;
	path: ObserverPath;
	body: Buffer;
	rawBodySha256: string;
}

export interface ObserverProcessedFields {
	path: ObserverPath;
	payload: unknown;
	result: unknown;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function sha256Hex(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON encoding for semantic comparisons across runtimes. */
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Cannot hash non-finite JSON");
		return JSON.stringify(value);
	}
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		return `{${Object.keys(object)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
			.join(",")}}`;
	}
	return "null";
}

export function semanticObserverSha256(
	path: ObserverPath,
	payload: unknown,
): string {
	return sha256Hex(canonicalJson({ path, payload }));
}

export function parseObserverBody<T>(body: Uint8Array): T {
	return JSON.parse(textDecoder.decode(body)) as T;
}

function stringField(payload: unknown, key: string): string | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function numberField(payload: unknown, key: string): number | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: null;
}

export async function appendObserverReceipt(
	db: Kysely<Database>,
	input: {
		network: string;
		path: ObserverPath;
		source: string | null;
		body: Uint8Array;
	},
): Promise<ObserverReceipt> {
	const body = Buffer.from(input.body);
	const rawBodySha256 = sha256Hex(body);
	// Receipt transaction is the acknowledgement durability boundary. The
	// local setting makes the insert wait for WAL flush before parsing.
	const row = await db.transaction().execute(async (tx) => {
		await sql`SET LOCAL synchronous_commit = 'on'`.execute(tx);
		return tx
			.insertInto("observer_journal")
			.values({
				network: input.network,
				path: input.path,
				source: input.source,
				raw_body: body,
				raw_body_sha256: rawBodySha256,
				status: "received",
				semantic_sha256: null,
				block_height: null,
				block_hash: null,
				burn_block_height: null,
				burn_block_hash: null,
				result: null,
				error: null,
				processed_at: null,
			})
			.returning("sequence")
			.executeTakeFirstOrThrow();
	});

	return {
		sequence: String(row.sequence),
		path: input.path,
		body,
		rawBodySha256,
	};
}

export async function markObserverProcessed(
	db: Kysely<Database>,
	receipt: ObserverReceipt,
	fields: ObserverProcessedFields,
): Promise<void> {
	const payload = fields.payload;
	await updateObserverStatus(db, receipt.sequence, "processed", {
		semantic_sha256: semanticObserverSha256(fields.path, payload),
		block_height: numberField(payload, "block_height"),
		block_hash: stringField(payload, "block_hash"),
		burn_block_height: numberField(payload, "burn_block_height"),
		burn_block_hash: stringField(payload, "burn_block_hash"),
		result: fields.result,
		error: null,
	});
}

export async function markObserverFailed(
	db: Kysely<Database>,
	receipt: ObserverReceipt,
	error: unknown,
): Promise<void> {
	await updateObserverStatus(db, receipt.sequence, "failed", {
		semantic_sha256: null,
		block_height: null,
		block_hash: null,
		burn_block_height: null,
		burn_block_hash: null,
		result: null,
		error: error instanceof Error ? error.message : String(error),
	});
}

async function updateObserverStatus(
	db: Kysely<Database>,
	sequence: string,
	status: ObserverJournalStatus,
	fields: {
		semantic_sha256: string | null;
		block_height: number | null;
		block_hash: string | null;
		burn_block_height: number | null;
		burn_block_hash: string | null;
		result: unknown | null;
		error: string | null;
	},
): Promise<void> {
	await db
		.updateTable("observer_journal")
		.set({
			status,
			semantic_sha256: fields.semantic_sha256,
			block_height: fields.block_height,
			block_hash: fields.block_hash,
			burn_block_height: fields.burn_block_height,
			burn_block_hash: fields.burn_block_hash,
			result: fields.result,
			error: fields.error,
			processed_at: new Date(),
		})
		.where("sequence", "=", sequence)
		.executeTakeFirstOrThrow();
}

export function bodyFromText(text: string): Uint8Array {
	return textEncoder.encode(text);
}
