import {
	type ContractInterfaceInput,
	generateContractInterface as buildContractInterface,
} from "@secondlayer/scaffold";
import type { ResolvedContract } from "../types/config";
import { formatCode } from "../utils/format";

/**
 * Code generator for contract interfaces.
 *
 * The generation logic lives in @secondlayer/scaffold (single-sourced so the
 * MCP server can reuse it); this wrapper applies Biome formatting on the CLI
 * output path.
 */
export async function generateContractInterface(
	contracts: ResolvedContract[],
): Promise<string> {
	return formatCode(
		buildContractInterface(contracts as ContractInterfaceInput[]),
	);
}
