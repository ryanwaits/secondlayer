import { SecondLayer } from "@secondlayer/sdk";
import type { Command } from "commander";
import {
	error as logError,
	note,
	output,
	success,
	writeData,
} from "../lib/output.ts";
import { resolveApiUrl, resolveEnvKey } from "../lib/resolve-auth.ts";

export function registerKeysCommand(program: Command): void {
	const keys = program
		.command("keys", { hidden: true })
		.description("Manage API keys");

	keys
		.command("create")
		.description(
			"Mint a scoped streams/index read key (requires an account-level key)",
		)
		.option("--product <product>", "Key scope: streams or index", "streams")
		.option("--name <name>", "Optional label for the key")
		.option("--json", "Print the full response as JSON")
		.action(async (o: { product?: string; name?: string; json?: boolean }) => {
			if (o.product && o.product !== "streams" && o.product !== "index") {
				logError("--product must be 'streams' or 'index'");
				process.exit(1);
			}
			const apiKey = resolveEnvKey();
			if (!apiKey) {
				logError(
					"No API key set. Export SL_API_KEY with an account-level key (issue one at https://www.secondlayer.tools/platform/api-keys).",
				);
				process.exit(1);
			}
			try {
				const sl = new SecondLayer({
					baseUrl: resolveApiUrl(),
					apiKey,
				});
				const minted = await sl.apiKeys.create({
					product: o.product === "index" ? "index" : "streams",
					name: o.name,
				});
				output({
					json: o.json,
					data: minted,
					human: () => {
						success(`Created ${minted.product} key (${minted.prefix}…)`);
						note("This key is shown once — store it now:");
						writeData(minted.key);
					},
				});
			} catch (err) {
				logError(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});
}
