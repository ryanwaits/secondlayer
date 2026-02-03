import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, mkdirSync, watch } from "node:fs";
import { success, error, info, dim, formatTable, formatKeyValue, green, yellow, red } from "../lib/output.ts";
import { generateViewTemplate } from "../templates/view.ts";
import { listViewsApi, getViewApi, reindexViewApi, deleteViewApi, deployViewApi, queryViewTable, queryViewTableCount } from "../lib/api-client.ts";
import type { ViewQueryParams } from "../lib/api-client.ts";
import { loadConfig, requireLocalNetwork } from "../lib/config.ts";

export function registerViewsCommand(program: Command): void {
  const views = program
    .command("views")
    .description("Manage materialized views");

  // --- new ---
  views
    .command("new <name>")
    .description("Scaffold a new view definition file")
    .action(async (name: string) => {
      const dir = resolve("views");
      const filePath = resolve(dir, `${name}.ts`);

      if (existsSync(filePath)) {
        error(`File already exists: ${filePath}`);
        process.exit(1);
      }

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const content = generateViewTemplate(name);
      await Bun.write(filePath, content);

      success(`Created ${filePath}`);
      info(`Next: streams views deploy views/${name}.ts`);
    });

  // --- dev ---
  views
    .command("dev <file>")
    .description("Watch a view file and auto-redeploy on change")
    .action(async (file: string) => {
      await requireLocalNetwork();

      const absPath = resolve(file);
      if (!existsSync(absPath)) {
        error(`File not found: ${absPath}`);
        process.exit(1);
      }

      info(`Watching ${absPath} for changes...`);
      info("Press Ctrl+C to stop\n");

      const deployView = async () => {
        try {
          // Clear module cache for hot reload
          delete require.cache[absPath];
          const mod = await import(`${absPath}?t=${Date.now()}`);
          const def = mod.default ?? mod;

          // @ts-expect-error - Dynamic import resolved at runtime
          const { validateViewDefinition } = await import("@secondlayer/views/validate");
          // @ts-expect-error - Dynamic import resolved at runtime
          const { deploySchema } = await import("@secondlayer/views");
          const { getDb } = await import("@secondlayer/shared/db");

          validateViewDefinition(def);
          const db = getDb();
          const result = await deploySchema(db, def, absPath, { forceReindex: false });

          if (result.action === "unchanged") {
            info(`[${new Date().toLocaleTimeString()}] No schema changes`);
          } else if (result.action === "created") {
            success(`[${new Date().toLocaleTimeString()}] View "${def.name}" created`);
          } else if (result.action === "updated") {
            success(`[${new Date().toLocaleTimeString()}] View "${def.name}" updated (additive)`);
          } else if (result.action === "reindexed") {
            success(`[${new Date().toLocaleTimeString()}] View "${def.name}" reindexed (breaking schema change)`);
          } else {
            success(`[${new Date().toLocaleTimeString()}] View "${def.name}" deployed (${result.action})`);
          }

          // Show handler stats
          const handlerKeys = Object.keys(def.handlers);
          info(`  Handlers: ${handlerKeys.join(", ")}`);
        } catch (err) {
          error(`[${new Date().toLocaleTimeString()}] ${err}`);
        }
      };

      // Initial deploy
      await deployView();

      // Watch with debounce
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(absPath, () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          console.log("");
          info("File changed, redeploying...");
          await deployView();
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
  views
    .command("deploy <file>")
    .description("Deploy a view definition file")
    .option("--reindex", "Force reindex on breaking schema change (drops and rebuilds all data)")
    .action(async (file: string, options: { reindex?: boolean }) => {
      try {
        const absPath = resolve(file);
        const config = await loadConfig();

        // Load and validate locally for fast feedback
        info(`Loading view from ${absPath}`);
        const mod = await import(absPath);
        const def = mod.default ?? mod;
        // @ts-expect-error - Dynamic import resolved at runtime
        const { validateViewDefinition } = await import("@secondlayer/views/validate");
        validateViewDefinition(def);

        if (config.network !== "local") {
          // ── Remote deploy ──────────────────────────────────────
          info(`Bundling for remote deploy (${config.network})...`);

          const buildResult = await Bun.build({
            entrypoints: [absPath],
            target: "bun",
            format: "esm",
            external: ["@secondlayer/views"],
          });

          if (!buildResult.success) {
            for (const msg of buildResult.logs) {
              error(String(msg));
            }
            process.exit(1);
          }

          const handlerCode = await buildResult.outputs[0]!.text();

          const result = await deployViewApi({
            name: def.name,
            version: def.version,
            description: def.description,
            sources: def.sources,
            schema: def.schema,
            handlerCode,
            reindex: options.reindex,
          });

          if (result.action === "unchanged") {
            info(`View "${def.name}" is up to date (no schema changes)`);
          } else {
            success(`View "${def.name}" ${result.action} (remote)`);
          }
        } else {
          // ── Local deploy ───────────────────────────────────────
          // @ts-expect-error - Dynamic import resolved at runtime
          const { deploySchema } = await import("@secondlayer/views");
          const { getDb, closeDb } = await import("@secondlayer/shared/db");

          const db = getDb();
          const result = await deploySchema(db, def, absPath, { forceReindex: options.reindex });

          if (result.action === "unchanged") {
            info(`View "${def.name}" is up to date (no schema changes)`);
          } else if (result.action === "created") {
            success(`View "${def.name}" created (id: ${result.viewId.slice(0, 8)})`);
          } else if (result.action === "reindexed") {
            success(`View "${def.name}" schema rebuilt (id: ${result.viewId.slice(0, 8)})`);
            info(`Reindexing will begin when view processor starts.`);
          } else {
            success(`View "${def.name}" updated (id: ${result.viewId.slice(0, 8)})`);
          }

          await closeDb();
        }
      } catch (err) {
        error(`Failed to deploy view: ${err}`);
        process.exit(1);
      }
    });

  // --- list ---
  views
    .command("list")
    .alias("ls")
    .description("List all deployed views")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const { data } = await listViewsApi();

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (data.length === 0) {
          console.log("No views deployed");
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
        console.log(dim(`\n${data.length} view(s) total`));
      } catch (err) {
        error(`Failed to list views: ${err}`);
        process.exit(1);
      }
    });

  // --- status ---
  views
    .command("status <name>")
    .description("Show detailed view status")
    .action(async (name: string) => {
      try {
        const view = await getViewApi(name);

        const rowCounts = Object.entries(view.tables)
          .map(([t, info]) => `${t}: ${info.rowCount}`)
          .join(", ") || "N/A";

        const errorRate = view.health.totalProcessed > 0
          ? `${(view.health.errorRate * 100).toFixed(2)}%`
          : "N/A";

        console.log(formatKeyValue([
          ["Name", view.name],
          ["Version", view.version],
          ["Status", view.status],
          ["Last Block", String(view.lastProcessedBlock)],
          ["Row Count", rowCounts],
          ["Total Processed", String(view.health.totalProcessed)],
          ["Total Errors", String(view.health.totalErrors)],
          ["Error Rate", errorRate],
          ["Last Error", view.health.lastError ?? "none"],
          ["Last Error At", view.health.lastErrorAt ?? "N/A"],
          ["Created", view.createdAt],
          ["Updated", view.updatedAt],
        ]));

        // Show table endpoints
        const tableEntries = Object.entries(view.tables);
        if (tableEntries.length > 0) {
          console.log(dim("\nTable endpoints:"));
          for (const [_t, info] of tableEntries) {
            console.log(dim(`  ${info.endpoint}`));
          }
        }
      } catch (err) {
        error(`Failed to get view status: ${err}`);
        process.exit(1);
      }
    });

  // --- reindex ---
  views
    .command("reindex <name>")
    .description("Reindex a view from historical blocks")
    .option("--from <block>", "Start block height")
    .option("--to <block>", "End block height")
    .action(async (name: string, options: { from?: string; to?: string }) => {
      try {
        info(`Reindexing view "${name}"...`);

        const result = await reindexViewApi(name, {
          fromBlock: options.from ? parseInt(options.from, 10) : undefined,
          toBlock: options.to ? parseInt(options.to, 10) : undefined,
        });

        success(result.message);
        info(`From block ${result.fromBlock} to ${result.toBlock}`);
      } catch (err) {
        error(`Failed to reindex view: ${err}`);
        process.exit(1);
      }
    });

  // --- query ---
  views
    .command("query <name> <table>")
    .description("Query a view table")
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

        const params: ViewQueryParams = {
          sort: options.sort,
          order: options.sort ? options.order : undefined,
          limit: parseInt(options.limit, 10),
          offset: options.offset ? parseInt(options.offset, 10) : undefined,
          fields: options.fields,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        };

        if (options.count) {
          const result = await queryViewTableCount(name, table, params);
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(result.count);
          }
          return;
        }

        const rows = await queryViewTable(name, table, params) as Record<string, unknown>[];

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
        error(`Failed to query view: ${err}`);
        process.exit(1);
      }
    });

  // --- delete ---
  views
    .command("delete <name>")
    .description("Delete a view and its data")
    .option("-y, --yes", "Skip confirmation")
    .action(async (name: string, options: { yes?: boolean }) => {
      try {
        if (!options.yes) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete view "${name}" and all its data? This cannot be undone.`,
          });
          if (!ok) {
            info("Cancelled");
            return;
          }
        }

        const result = await deleteViewApi(name);
        success(result.message);
      } catch (err) {
        error(`Failed to delete view: ${err}`);
        process.exit(1);
      }
    });
}
