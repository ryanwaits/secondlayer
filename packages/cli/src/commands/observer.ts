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
		// --network is deliberately NOT declared here — see the identical note
		// in commands/init.ts: it collides with cli.ts's global `--network`,
		// which silently wins and leaves a command-local option `undefined`.
		// Read the global preAction hook's STACKS_NETWORK instead.
		.addHelpText(
			"after",
			`
--network <mainnet|testnet|devnet> is the top-level global flag (see
\`secondlayer --help\`) — default mainnet, same as before.
`,
		)
		.action(
			(opts: {
				mode: string;
				endpoint?: string;
				recovery?: string;
			}) => {
				const mode = parseObserverMode(opts.mode);
				const network = parseInstanceNetwork(
					process.env.STACKS_NETWORK ?? "mainnet",
				);
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
