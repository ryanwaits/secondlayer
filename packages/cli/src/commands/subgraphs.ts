import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, mkdirSync, watch } from "node:fs";
import { success, error, info, dim, formatTable, formatKeyValue, green, yellow, red } from "../lib/output.ts";
import { generateSubgraphTemplate } from "../templates/subgraph.ts";
import { listSubgraphsApi, getSubgraphApi, reindexSubgraphApi, deleteSubgraphApi, deploySubgraphApi, querySubgraphTable, querySubgraphTableCount, handleApiError } from "../lib/api-client.ts";
import type { SubgraphQueryParams } from "../lib/api-client.ts";
import { loadConfig, requireLocalNetwork } from "../lib/config.ts";
import { writeTextFile } from "../lib/fs.ts";
import { generateSubgraphScaffold } from "../generators/subgraph-scaffold.ts";
import { generateSubgraphConsumer } from "../generators/subgraphs.ts";
import { StacksApiClient } from "../utils/api.ts";
import { inferNetwork } from "../utils/network.ts";
import { parseApiResponse } from "../parsers/clarity.ts";

export function registerSubgraphsCommand(program: Command): void {
  const subgraphs = program
    .command("subgraphs")
    .description("Manage materialized subgraphs");

  // --- new ---
  subgraphs
    .command("new <name>")
    .description("Scaffold a new subgraph definition file")
    .action(async (name: string) => {
      const dir = resolve("subgraphs");
      const filePath = resolve(dir, `${name}.ts`);

      if (existsSync(filePath)) {
        error(`File already exists: ${filePath}`);
        process.exit(1);
      }

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const content = generateSubgraphTemplate(name);
      await writeTextFile(filePath, content);

      success(`Created ${filePath}`);
      info(`Next: sl subgraphs deploy subgraphs/${name}.ts`);
    });

  // --- dev ---
  subgraphs
    .command("dev <file>")
    .description("Watch a subgraph file and auto-redeploy on change")
    .action(async (file: string) => {
      await requireLocalNetwork();

      const absPath = resolve(file);
      if (!existsSync(absPath)) {
        error(`File not found: ${absPath}`);
        process.exit(1);
      }

      info(`Watching ${absPath} for changes...`);
      info("Press Ctrl+C to stop\n");

      const deploySubgraph = async () => {
        try {
          // Clear module cache for hot reload
          delete require.cache[absPath];
          const mod = await import(`${absPath}?t=${Date.now()}`);
          const def = mod.default ?? mod;

          const { validateSubgraphDefinition } = await import("@secondlayer/subgraphs/validate");
          const { deploySchema } = await import("@secondlayer/subgraphs");
          const { getDb } = await import("@secondlayer/shared/db");

          validateSubgraphDefinition(def);
          const db = getDb();
          const result = await deploySchema(db, def, absPath, { forceReindex: false });

          if (result.action === "unchanged") {
            info(`[${new Date().toLocaleTimeString()}] No schema changes`);
          } else if (result.action === "created") {
            success(`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" created`);
          } else if (result.action === "updated") {
            success(`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" updated (additive)`);
          } else if (result.action === "reindexed") {
            success(`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" reindexed (breaking schema change)`);
          } else {
            success(`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" deployed (${result.action})`);
          }

          // Show handler stats
          const handlerKeys = Object.keys(def.handlers);
          info(`  Handlers: ${handlerKeys.join(", ")}`);
        } catch (err) {
          error(`[${new Date().toLocaleTimeString()}] ${err}`);
        }
      };

      // Initial deploy
      await deploySubgraph();

      // Watch with debounce
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(absPath, () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          console.log("");
          info("File changed, redeploying...");
          await deploySubgraph();
        }, 300);
      });

      // Graceful shutdown
      process.on("SIGINT", () => {
        watcher.close();
        if (timeout) clearTimeout(timeout);
        console.log("\nStopped watching.");
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    });

  // --- deploy ---
  subgraphs
    .command("deploy <file>")
    .description("Deploy a subgraph definition file")
    .option("--reindex", "Force reindex on breaking schema change (drops and rebuilds all data)")
    .action(async (file: string, options: { reindex?: boolean }) => {
      try {
        const absPath = resolve(file);
        const config = await loadConfig();

        // Load and validate locally for fast feedback
        info(`Loading subgraph from ${absPath}`);
        const mod = await import(absPath);
        const def = mod.default ?? mod;
        const { validateSubgraphDefinition } = await import("@secondlayer/subgraphs/validate");
        validateSubgraphDefinition(def);

        if (config.network !== "local") {
          // ── Remote deploy ──────────────────────────────────────
          info(`Bundling for remote deploy (${config.network})...`);

          const esbuild = await import("esbuild");
          const buildResult = await esbuild.build({
            entryPoints: [absPath],
            bundle: true,
            platform: "node",
            format: "esm",
            external: ["@secondlayer/subgraphs"],
            write: false,
          });

          const handlerCode = new TextDecoder().decode(buildResult.outputFiles![0]!.contents);

          const { sourceKey } = await import("@secondlayer/subgraphs");
          const result = await deploySubgraphApi({
            name: def.name,
            version: def.version,
            description: def.description,
            sources: def.sources.map(sourceKey),
            schema: def.schema,
            handlerCode,
            reindex: options.reindex,
          });

          if (result.action === "unchanged") {
            info(`Subgraph "${def.name}" is up to date (no schema changes)`);
          } else {
            success(`Subgraph "${def.name}" ${result.action} (remote)`);
          }
        } else {
          // ── Local deploy ───────────────────────────────────────
          const { deploySchema } = await import("@secondlayer/subgraphs");
          const { getDb, closeDb } = await import("@secondlayer/shared/db");

          const db = getDb();
          const result = await deploySchema(db, def, absPath, { forceReindex: options.reindex });

          if (result.action === "unchanged") {
            info(`Subgraph "${def.name}" is up to date (no schema changes)`);
          } else if (result.action === "created") {
            success(`Subgraph "${def.name}" created (id: ${result.subgraphId.slice(0, 8)})`);
          } else if (result.action === "reindexed") {
            success(`Subgraph "${def.name}" schema rebuilt (id: ${result.subgraphId.slice(0, 8)})`);
            info(`Reindexing will begin when subgraph processor starts.`);
          } else {
            success(`Subgraph "${def.name}" updated (id: ${result.subgraphId.slice(0, 8)})`);
          }

          await closeDb();
        }
      } catch (err) {
        error(`Failed to deploy subgraph: ${err}`);
        process.exit(1);
      }
    });

  // --- list ---
  subgraphs
    .command("list")
    .alias("ls")
    .description("List all deployed subgraphs")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const { data } = await listSubgraphsApi();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (data.length === 0) {
          console.log("No subgraphs deployed");
          return;
        }

        const tableRows = data.map((v) => {
          const statusColor = v.status === "active" ? green : v.status === "error" ? red : yellow;
          return [
            v.name,
            v.version,
            statusColor(v.status),
            String(v.lastProcessedBlock),
            v.tables.join(", ") || "—",
          ];
        });

        console.log(formatTable(
          ["Name", "Version", "Status", "Last Block", "Tables"],
          tableRows,
        ));
        console.log(dim(`\n${data.length} subgraph(s) total`));
      } catch (err) {
        handleApiError(err, "list subgraphs");
      }
    });

  // --- status ---
  subgraphs
    .command("status <name>")
    .description("Show detailed subgraph status")
    .action(async (name: string) => {
      try {
        const subgraph = await getSubgraphApi(name);

        const rowCounts = Object.entries(subgraph.tables)
          .map(([t, info]: [string, { rowCount: number }]) => `${t}: ${info.rowCount}`)
          .join(", ") || "N/A";

        const errorRate = subgraph.health.totalProcessed > 0
          ? `${(subgraph.health.errorRate * 100).toFixed(2)}%`
          : "N/A";

        console.log(formatKeyValue([
          ["Name", subgraph.name],
          ["Version", subgraph.version],
          ["Status", subgraph.status],
          ["Last Block", String(subgraph.lastProcessedBlock)],
          ["Row Count", rowCounts],
          ["Total Processed", String(subgraph.health.totalProcessed)],
          ["Total Errors", String(subgraph.health.totalErrors)],
          ["Error Rate", errorRate],
          ["Last Error", subgraph.health.lastError ?? "none"],
          ["Last Error At", subgraph.health.lastErrorAt ?? "N/A"],
          ["Created", subgraph.createdAt],
          ["Updated", subgraph.updatedAt],
        ]));

        // Show table endpoints
        const tableEntries = Object.entries(subgraph.tables);
        if (tableEntries.length > 0) {
          console.log(dim("\nTable endpoints:"));
          for (const [_t, info] of tableEntries as [string, { endpoint: string }][]) {
            console.log(dim(`  ${info.endpoint}`));
          }
        }
      } catch (err) {
        handleApiError(err, "get subgraph status");
      }
    });

  // --- reindex ---
  subgraphs
    .command("reindex <name>")
    .description("Reindex a subgraph from historical blocks")
    .option("--from <block>", "Start block height")
    .option("--to <block>", "End block height")
    .action(async (name: string, options: { from?: string; to?: string }) => {
      try {
        info(`Reindexing subgraph "${name}"...`);

        const result = await reindexSubgraphApi(name, {
          fromBlock: options.from ? parseInt(options.from, 10) : undefined,
          toBlock: options.to ? parseInt(options.to, 10) : undefined,
        });

        success(result.message);
        info(`From block ${result.fromBlock} to ${result.toBlock}`);
      } catch (err) {
        handleApiError(err, "reindex subgraph");
      }
    });

  // --- query ---
  subgraphs
    .command("query <name> <table>")
    .description("Query a subgraph table")
    .option("--sort <column>", "Sort by column")
    .option("--order <dir>", "Sort direction (asc|desc)", "asc")
    .option("--limit <n>", "Max rows to return", "20")
    .option("--offset <n>", "Skip first N rows")
    .option("--fields <cols>", "Comma-separated columns to include")
    .option("--filter <kv...>", "Filter as key=value (supports .gte/.lte/.gt/.lt/.neq suffixes)")
    .option("--count", "Return row count only")
    .option("--json", "Output as JSON")
    .action(async (name: string, table: string, options: {
      sort?: string;
      order: string;
      limit: string;
      offset?: string;
      fields?: string;
      filter?: string[];
      count?: boolean;
      json?: boolean;
    }) => {
      try {
        const filters: Record<string, string> = {};
        if (options.filter) {
          for (const kv of options.filter) {
            const eqIndex = kv.indexOf("=");
            if (eqIndex === -1) {
              error(`Invalid filter format: "${kv}". Use key=value.`);
              process.exit(1);
            }
            filters[kv.slice(0, eqIndex)] = kv.slice(eqIndex + 1);
          }
        }

        const params: SubgraphQueryParams = {
          sort: options.sort,
          order: options.sort ? options.order : undefined,
          limit: parseInt(options.limit, 10),
          offset: options.offset ? parseInt(options.offset, 10) : undefined,
          fields: options.fields,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        };

        if (options.count) {
          const result = await querySubgraphTableCount(name, table, params);
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(result.count);
          }
          return;
        }

        const rows = await querySubgraphTable(name, table, params) as Record<string, unknown>[];

        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log(dim("No rows found"));
          return;
        }

        const columns = Object.keys(rows[0]!);
        const tableRows = rows.map((row) =>
          columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return dim("-");
            if (typeof val === "object") return JSON.stringify(val);
            return String(val);
          })
        );

        console.log(formatTable(columns, tableRows));
        console.log(dim(`\n${rows.length} row(s)`));
      } catch (err) {
        handleApiError(err, "query subgraph");
      }
    });

  // --- delete ---
  subgraphs
    .command("delete <name>")
    .description("Delete a subgraph and its data")
    .option("-y, --yes", "Skip confirmation")
    .action(async (name: string, options: { yes?: boolean }) => {
      try {
        if (!options.yes) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete subgraph "${name}" and all its data? This cannot be undone.`,
          });
          if (!ok) {
            info("Cancelled");
            return;
          }
        }

        const result = await deleteSubgraphApi(name);
        success(result.message);
      } catch (err) {
        handleApiError(err, "delete subgraph");
      }
    });

  // --- scaffold ---
  subgraphs
    .command("scaffold <contractAddress>")
    .description("Scaffold a defineSubgraph() file from a contract ABI")
    .option("-o, --output <path>", "Output file path (required)")
    .option("--api-key <key>", "Hiro API key")
    .action(async (contractAddress: string, options: { output?: string; apiKey?: string }) => {
      try {
        if (!options.output) {
          error("--output <path> is required");
          process.exit(1);
        }

        const outPath = resolve(options.output);
        const network = inferNetwork(contractAddress) ?? "mainnet";
        const apiKey = options.apiKey ?? process.env.HIRO_API_KEY;

        info(`Fetching ABI for ${contractAddress}...`);
        const client = new StacksApiClient(network, apiKey);
        const contractInfo = await client.getContractInfo(contractAddress);
        const abi = parseApiResponse(contractInfo);

        info(`Generating scaffold...`);
        const content = await generateSubgraphScaffold({
          contractId: contractAddress,
          functions: abi.functions,
        });

        const dir = resolve(outPath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        await writeTextFile(outPath, content);

        success(`Created ${outPath}`);
        info(`Next: sl subgraphs deploy ${options.output}`);
      } catch (err) {
        error(`Failed to scaffold subgraph: ${err}`);
        process.exit(1);
      }
    });

  // --- generate ---
  subgraphs
    .command("generate <subgraphName>")
    .description("Generate a typed client for a deployed subgraph")
    .option("-o, --output <path>", "Output file path (required)")
    .action(async (subgraphName: string, options: { output?: string }) => {
      try {
        if (!options.output) {
          error("--output <path> is required");
          process.exit(1);
        }

        const outPath = resolve(options.output);

        info(`Fetching subgraph metadata for "${subgraphName}"...`);
        const subgraphDetail = await getSubgraphApi(subgraphName);

        info(`Generating typed client...`);
        const content = await generateSubgraphConsumer(subgraphName, subgraphDetail);

        const dir = resolve(outPath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        await writeTextFile(outPath, content);

        success(`Created ${outPath}`);
      } catch (err) {
        handleApiError(err, "generate subgraph client");
      }
    });
}
