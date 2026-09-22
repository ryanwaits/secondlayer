// Ported from ord 0.29.0 `crates/ordinals/src/edict.rs`.

import type { RuneId } from "./rune_id.ts";

export interface Edict {
	id: RuneId;
	amount: bigint;
	output: number;
}

const U32_MAX = 4_294_967_295n;

export interface TxOutputsLike {
	outputs: unknown[];
}

export function edictFromIntegers(
	tx: TxOutputsLike,
	id: RuneId,
	amount: bigint,
	output: bigint,
): Edict | undefined {
	if (output < 0n || output > U32_MAX) return undefined; // u32::try_from(output)
	const outputNum = Number(output);

	// note that this allows `output == tx.output.len()`, which means to divide
	// amount between all non-OP_RETURN outputs
	if (outputNum > tx.outputs.length) return undefined;

	return { id, amount, output: outputNum };
}
