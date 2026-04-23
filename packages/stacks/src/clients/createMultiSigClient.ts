import type { MultiSigHashMode } from "../transactions/types.ts";
import { createClient } from "./createClient.ts";
import {
	type MultiSigActions,
	multisigActions,
} from "./decorators/multisig.ts";
import type { Client, ClientConfig } from "./types.ts";

/** Configuration for {@link createMultiSigClient} — requires signer public keys and threshold. */
export type MultiSigClientConfig = Omit<ClientConfig, "account"> & {
	signers: string[];
	requiredSignatures: number;
	hashMode?: MultiSigHashMode;
};

/** A client pre-extended with {@link MultiSigActions} for m-of-n signing flows. */
export type MultiSigClient = Client<MultiSigActions> & MultiSigActions;

/**
 * Create a client for multi-sig transaction flows.
 * Builds unsigned transactions that can be signed by each party then broadcast.
 */
export function createMultiSigClient(
	config: MultiSigClientConfig,
): MultiSigClient {
	const client = createClient(config);

	// Attach multi-sig config for the decorator to read
	(client as any)._multisigConfig = {
		signers: config.signers,
		requiredSignatures: config.requiredSignatures,
		hashMode: config.hashMode,
	};

	return client.extend(multisigActions) as any;
}
