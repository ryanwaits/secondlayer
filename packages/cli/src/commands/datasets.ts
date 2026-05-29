import { CURSOR_SLUGS, Datasets } from "@secondlayer/sdk";
import type { Command } from "commander";
import { error as logError, note, output, writeData } from "../lib/output.ts";

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

function client(): Datasets {
	// Dataset reads are public — no API key required.
	return new Datasets({ baseUrl: process.env.SL_API_URL ?? DEFAULT_BASE_URL });
}

/** Parse repeated `--filter key=value` into a params record. */
function parseFilters(pairs: string[] | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const pair of pairs ?? []) {
		const eq = pair.indexOf("=");
		if (eq <= 0) {
			throw new Error(`invalid --filter "${pair}" (expected key=value)`);
		}
		out[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	return out;
}

export function registerDatasetsCommand(program: Command): void {
	const datasets = program
		.command("datasets")
		.description("Query Foundation Datasets (sBTC, BNS, PoX-4, STX transfers)");

	datasets
		.command("list")
		.description("List the dataset catalog + freshness")
		.action(async () => {
			try {
				const catalog = await client().listDatasets();
				writeData(JSON.stringify(catalog, null, 2));
			} catch (err) {
				logError(`Failed to list datasets: ${err}`);
				process.exit(1);
			}
		});

	datasets
		.command("query <dataset>")
		.description(
			`Query a cursor-paginated dataset (${Object.keys(CURSOR_SLUGS).join(", ")})`,
		)
		.option(
			"--filter <key=value...>",
			"Filter as key=value (e.g. --filter stacker=SP… --filter address=SP…)",
		)
		.option("--limit <n>", "Rows per page")
		.option("--cursor <cursor>", "Resume token from a previous next_cursor")
		.option("--json", "Print the full envelope as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ sl datasets query stx-transfers --filter sender=SP2J6ZY... --limit 100
  $ sl datasets query sbtc-events --filter amount.gte=1000
  $ sl datasets query bns-events --cursor 150000:3 --json`,
		)
		.action(
			async (
				dataset: string,
				options: {
					filter?: string[];
					limit?: string;
					cursor?: string;
					json?: boolean;
				},
			) => {
				try {
					const params: Record<string, unknown> = parseFilters(options.filter);
					if (options.limit) params.limit = Number.parseInt(options.limit, 10);
					if (options.cursor) params.cursor = options.cursor;

					const env = await client().query(dataset, params);
					output({
						json: options.json,
						data: env,
						human: () => {
							writeData(JSON.stringify(env.rows, null, 2));
							if (env.next_cursor) note(`next_cursor: ${env.next_cursor}`);
						},
					});
				} catch (err) {
					logError(`Failed to query dataset: ${err}`);
					process.exit(1);
				}
			},
		);
}
