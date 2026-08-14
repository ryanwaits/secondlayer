import { SecondLayer } from "@secondlayer/sdk";
import type { Command } from "commander";
import { error as logError, output, writeData } from "../lib/output.ts";
import { resolveApiUrl, resolveEnvKey } from "../lib/resolve-auth.ts";

export function registerContextCommand(program: Command): void {
	program
		.command("context")
		.description(
			"Print an agent orientation snapshot: account, live Streams/Index tips, your subgraphs/subscriptions, and in-flight reindex operations",
		)
		.option("--json", "Print as JSON (default)")
		.action(async (o: { json?: boolean }) => {
			try {
				const sl = new SecondLayer({
					baseUrl: resolveApiUrl(),
					apiKey: resolveEnvKey(),
				});
				const snapshot = await sl.context();
				output({
					json: o.json,
					data: snapshot,
					human: () => writeData(JSON.stringify(snapshot, null, 2)),
				});
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});
}
