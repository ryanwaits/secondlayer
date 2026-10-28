import type { PrintSchemaResponse } from "@secondlayer/sdk";

export interface ScaffoldStartBlock {
	height: number;
	comment: string;
}

/**
 * Start block for a print-schema scaffold. The first deploy backfills from
 * `startBlock`, so a missing one means genesis. When the schema covers every
 * print event, its oldest height is the contract's first indexed event and
 * loses nothing. A sampled schema's oldest height is not the first event, so
 * fall back to the current tip.
 */
export function scaffoldStartBlock(
	schema: Pick<PrintSchemaResponse, "sampled" | "sample" | "tip">,
): ScaffoldStartBlock {
	const first = schema.sample.oldest_height;
	if (!schema.sampled && first != null) {
		return {
			height: first,
			comment: "First indexed print event. A lower start block backfills more.",
		};
	}
	return {
		height: schema.tip.block_height,
		comment:
			"Recent height, skips history. A lower start block backfills more.",
	};
}

/** Insert `startBlock` after the `name:` line of the `defineSubgraph({` call. */
export function withStartBlock(
	code: string,
	{ height, comment }: ScaffoldStartBlock,
): string {
	const out = code.replace(
		/(defineSubgraph\(\{\n\s*name: [^\n]*\n)(\s*)/,
		(_match, head: string, indent: string) =>
			`${head}${indent}// ${comment}\n${indent}startBlock: ${height},\n${indent}`,
	);
	if (out === code) {
		throw new Error("scaffold has no defineSubgraph name to place startBlock");
	}
	return out;
}
