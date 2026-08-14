import type { Command } from "commander";
import { parseInstanceNetwork } from "../lib/instance-init.ts";
import {
	defaultObserverEndpoint,
	parseObserverMode,
	parseRecoverySource,
	renderObserverStanza,
} from "../lib/observer-stanza.ts";
import { note, writeData } from "../lib/output.ts";

export function registerObserverCommand(program: Command): void {
	program
		.command("observer")
		.description("Print the Stacks events_observer stanza for this node mode")
		.option(
			"--mode <mode>",
			"indexer (retry) or signer-shared (no retry)",
			"indexer",
		)
		.option("--endpoint <host:port>", "Observer callback the node will POST to")
		.option(
			"--recovery <source>",
			"Required for signer-shared: journal or archive",
		)
		.option(
			"--network <network>",
			"mainnet, testnet, or devnet",
			process.env.STACKS_NETWORK ?? "mainnet",
		)
		.action(
			(opts: {
				mode: string;
				endpoint?: string;
				network: string;
				recovery?: string;
			}) => {
				const mode = parseObserverMode(opts.mode);
				const network = parseInstanceNetwork(opts.network);
				const endpoint = opts.endpoint ?? defaultObserverEndpoint(network);
				const recovery = opts.recovery
					? parseRecoverySource(opts.recovery)
					: undefined;
				if (mode === "signer-shared") {
					note(
						"Signer-shared nodes skip observer retries. Pair with a journal or archive for completeness.",
					);
				}
				writeData(renderObserverStanza({ mode, endpoint, network, recovery }));
			},
		);
}
