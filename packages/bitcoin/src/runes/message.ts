// Ported from ord 0.29.0 `crates/ordinals/src/runestone/message.rs`.

import { type Edict, type TxOutputsLike, edictFromIntegers } from "./edict.ts";
import { Flaw } from "./flaw.ts";
import { runeIdDefault, runeIdNext } from "./rune_id.ts";
import { Tag } from "./tag.ts";

export interface Message {
	flaw?: Flaw;
	edicts: Edict[];
	fields: Map<bigint, bigint[]>;
}

export function messageFromIntegers(
	tx: TxOutputsLike,
	payload: bigint[],
): Message {
	const edicts: Edict[] = [];
	const fields = new Map<bigint, bigint[]>();
	let flaw: Flaw | undefined;

	for (let i = 0; i < payload.length; i += 2) {
		const tag = payload[i] as bigint;

		if (tag === BigInt(Tag.Body)) {
			let id = runeIdDefault();
			const rest = payload.slice(i + 1);
			for (let c = 0; c < rest.length; c += 4) {
				const chunk = rest.slice(c, c + 4);
				if (chunk.length !== 4) {
					flaw = flaw ?? Flaw.TrailingIntegers;
					break;
				}

				const next = runeIdNext(id, chunk[0] as bigint, chunk[1] as bigint);
				if (next === undefined) {
					flaw = flaw ?? Flaw.EdictRuneId;
					break;
				}

				const edict = edictFromIntegers(
					tx,
					next,
					chunk[2] as bigint,
					chunk[3] as bigint,
				);
				if (edict === undefined) {
					flaw = flaw ?? Flaw.EdictOutput;
					break;
				}

				id = next;
				edicts.push(edict);
			}
			break;
		}

		const value = payload[i + 1];
		if (value === undefined) {
			flaw = flaw ?? Flaw.TruncatedField;
			break;
		}

		const existing = fields.get(tag);
		if (existing) existing.push(value);
		else fields.set(tag, [value]);
	}

	return { flaw, edicts, fields };
}
