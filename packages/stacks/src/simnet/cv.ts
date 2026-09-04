import type { Simnet } from "@stacks/clarinet-sdk";
import {
	type ClarityValue as StacksCV,
	Cl as StacksCl,
} from "@stacks/transactions";
import {
	type ClarityValue,
	deserializeCV,
	serializeCV,
} from "../clarity/index.ts";

/** Our CV → clarinet-sdk / @stacks/transactions CV via consensus bytes. */
export function toChain(cv: ClarityValue): StacksCV {
	return StacksCl.deserialize(serializeCV(cv));
}

/** clarinet-sdk CV → ours, same wire. */
export function fromChain(cv: StacksCV): ClarityValue {
	return deserializeCV(StacksCl.serialize(cv));
}

export function hexCv(cv: ClarityValue): string {
	return `0x${serializeCV(cv)}`;
}

export function cvFromHex(hex: string): ClarityValue {
	return deserializeCV(hex);
}

export function stxBalance(session: Simnet, address: string): bigint {
	const holders = session.getAssetsMap().get("STX");
	return holders?.get(address) ?? 0n;
}
