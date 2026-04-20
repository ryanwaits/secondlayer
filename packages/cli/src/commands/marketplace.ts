import type { Command } from "commander";
import {
	browseMarketplace,
	forkMarketplaceSubgraph,
	getMarketplaceSubgraph,
	handleApiError,
} from "../lib/api-client.ts";
import {
	cyan,
	dim,
	formatKeyValue,
	formatTable,
	success,
} from "../lib/output.ts";

export function registerMarketplaceCommand(program: Command): void {
	const marketplace = program
		.command("marketplace")
		.alias("mp")
		.description("Browse the public subgraph marketplace");

	marketplace
		.command("browse")
		.description("List public subgraphs")
		.option("--tags <tags>", "Filter by tags (comma-separated)")
		.option("--search <query>", "Search by name or description")
		.option("--sort <field>", "Sort by: recent, popular, name", "recent")
		.option("--limit <n>", "Max results", "20")
		.option("--json", "Output as JSON")
		.action(
			async (options: {
				tags?: string;
				search?: string;
				sort?: string;
				limit?: string;
				json?: boolean;
			}) => {
				try {
					const result = await browseMarketplace({
						tags: options.tags
							? options.tags.split(",").map((t) => t.trim())
							: undefined,
						search: options.search,
						sort: options.sort as "recent" | "popular" | "name" | undefined,
						limit: Number.parseInt(options.limit ?? "20", 10),
					});

					if (options.json) {
						console.log(JSON.stringify(result, null, 2));
						return;
					}

					if (result.data.length === 0) {
						console.log(dim("No public subgraphs found"));
						return;
					}

					const rows = result.data.map((s) => [
						s.name,
						s.creator?.displayName ?? s.creator?.slug ?? dim("—"),
						(s.tags ?? []).join(", ") || dim("—"),
						s.status,
					]);

					console.log(formatTable(["Name", "Creator", "Tags", "Status"], rows));
					console.log(dim(`\n${result.meta.total} subgraph(s) total`));
				} catch (err) {
					handleApiError(err, "browse marketplace");
				}
			},
		);

	marketplace
		.command("view <name>")
		.description("View a public subgraph's details")
		.option("--json", "Output as JSON")
		.action(async (name: string, options: { json?: boolean }) => {
			try {
				const detail = await getMarketplaceSubgraph(name);

				if (options.json) {
					console.log(JSON.stringify(detail, null, 2));
					return;
				}

				console.log(
					formatKeyValue([
						["Name", detail.name],
						["Description", detail.description ?? dim("—")],
						[
							"Creator",
							detail.creator?.displayName ?? detail.creator?.slug ?? dim("—"),
						],
						["Status", detail.status],
						["Version", detail.version],
						["Tags", (detail.tags ?? []).join(", ") || dim("—")],
						["Tables", detail.tables?.join(", ") ?? dim("—")],
						["Start Block", String(detail.startBlock)],
						["Last Processed", String(detail.lastProcessedBlock)],
						["Queries (7d)", String(detail.usage?.totalQueries7d ?? 0)],
						["Queries (30d)", String(detail.usage?.totalQueries30d ?? 0)],
						["Created", detail.createdAt],
					]),
				);

				if (detail.tableSchemas) {
					console.log(dim("\nEndpoints:"));
					for (const [table, schema] of Object.entries(detail.tableSchemas)) {
						console.log(
							`  ${cyan(table)} — ${schema.rowCount} rows — ${schema.endpoint}`,
						);
					}
				}
			} catch (err) {
				handleApiError(err, "view subgraph");
			}
		});

	marketplace
		.command("fork <name>")
		.description("Fork a public subgraph into your account")
		.option("--name <newName>", "Name for the forked subgraph")
		.option("--json", "Output as JSON")
		.action(
			async (name: string, options: { name?: string; json?: boolean }) => {
				try {
					const result = await forkMarketplaceSubgraph(name, options.name);

					if (options.json) {
						console.log(JSON.stringify(result, null, 2));
						return;
					}

					success(`Forked ${result.forkedFrom} as ${result.name}`);
					console.log(dim(`Subgraph ID: ${result.subgraphId}`));
					console.log(
						dim(
							"Indexing will start automatically from the source's start block.",
						),
					);
				} catch (err) {
					handleApiError(err, "fork subgraph");
				}
			},
		);
}
