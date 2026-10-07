// Clarity MARF keys, mirroring stacks-core clarity_db.rs make_key_for_trip /
// make_key_for_quad. The leaf path is `marfPath(key)`.
import { type ClarityValue, serializeCV } from "@secondlayer/stacks/clarity";
import { c32addressDecode } from "@secondlayer/stacks/utils";
import { unhex } from "./bytes.ts";

/** clarity_db.rs StoreType discriminants (formatted in decimal inside keys). */
const StoreType = { DataMap: 0, Variable: 1, FungibleToken: 2 } as const;

/** `vm::<contract>::0::<map>::<serialized key hex>` (make_key_for_data_map_entry). */
export function mapEntryKey(
	contractId: string,
	mapName: string,
	key: ClarityValue,
): string {
	return `vm::${contractId}::${StoreType.DataMap}::${mapName}::${serializeCV(key)}`;
}

/** `vm::<contract>::1::<var>` (make_key_for_trip, StoreType::Variable). */
export function dataVarKey(contractId: string, varName: string): string {
	return `vm::${contractId}::${StoreType.Variable}::${varName}`;
}

/**
 * `vm::<contract>::2::<token>::<principal json>` (get_ft_balance). The holder
 * is serde-JSON PrincipalData, e.g. `{"Standard":[22,[...20 bytes]]}`.
 */
export function ftBalanceKey(
	contractId: string,
	tokenName: string,
	holder: string,
): string {
	return `vm::${contractId}::${StoreType.FungibleToken}::${tokenName}::${principalJson(holder)}`;
}

function principalJson(principal: string): string {
	const dot = principal.indexOf(".");
	const address = dot === -1 ? principal : principal.slice(0, dot);
	const [version, hash160] = c32addressDecode(address);
	const issuer = [version, Array.from(unhex(hash160))];
	if (dot === -1) return JSON.stringify({ Standard: issuer });
	return JSON.stringify({
		Contract: { issuer, name: principal.slice(dot + 1) },
	});
}
