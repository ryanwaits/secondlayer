import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely } from "kysely";

export type StreamsCanonicalBlock = {
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	is_canonical: true;
};

export type StreamsCanonicalBlockReader = (
	height: number,
) => Promise<StreamsCanonicalBlock | null>;

export function parseStreamsHeight(value: string, name = "height"): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	return parsed;
}

export function createCanonicalBlockReader(
	db: Kysely<Database> = getSourceDb(),
): StreamsCanonicalBlockReader {
	return async (height: number) => {
		const row = await db
			.selectFrom("blocks")
			.select(["height", "hash", "burn_block_height", "burn_block_hash"])
			.where("height", "=", height)
			.where("canonical", "=", true)
			.executeTakeFirst();

		if (!row) return null;

		return {
			block_height: Number(row.height),
			index_block_hash: row.hash,
			burn_block_height: Number(row.burn_block_height),
			burn_block_hash: row.burn_block_hash ?? null,
			is_canonical: true,
		};
	};
}

export const readCanonicalStreamsBlock = createCanonicalBlockReader();
