import { z } from "zod";

const block = (name: string) =>
	z
		.number({ error: `${name} is required and must be a number` })
		.int(`${name} must be an integer`)
		.min(1, `${name} must be at least 1`);

/**
 * The block range a backfill covers: whole blocks, `fromBlock <= toBlock`, and
 * nothing past the chain tip (blocks that do not exist yet cannot be
 * processed, and a range reaching them would queue work that can never finish).
 * Throws a `ZodError`, which the API answers as a 400.
 */
export function parseBackfillRange(
	body: unknown,
	chainTip: number,
): { fromBlock: number; toBlock: number } {
	return z
		.object({ fromBlock: block("fromBlock"), toBlock: block("toBlock") })
		.refine((range) => range.fromBlock <= range.toBlock, {
			error: "fromBlock must be at or below toBlock",
			path: ["fromBlock"],
		})
		.refine((range) => range.toBlock <= chainTip, {
			error: `toBlock must be at or below the chain tip (${chainTip})`,
			path: ["toBlock"],
		})
		.parse(body);
}
