import { getDb } from "@secondlayer/shared/db";
import { getInstance } from "@secondlayer/shared/db/queries/instance";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { Hono } from "hono";
import { sql } from "kysely";
import { INSTANCE_FEATURE_MANIFEST } from "../instance-features.ts";

const PROCESS_STARTED_AT = Date.now();

export function createInstanceCatalogRouter() {
	const app = new Hono();

	app.get("/features", (c) =>
		c.json({
			mode: getInstanceMode(),
			features: INSTANCE_FEATURE_MANIFEST,
		}),
	);

	// Operational vitals for the console: process uptime, database footprint,
	// 24h webhook delivery outcomes, and a rows-processed series derived from
	// health snapshots. Everything here is cheap aggregates; an unreachable
	// table degrades to null rather than failing the whole payload.
	app.get("/metrics", async (c) => {
		const db = getDb();
		const uptimeSeconds = Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000);

		let dbSizeBytes: number | null = null;
		try {
			const size = await sql<{
				bytes: string;
			}>`SELECT pg_database_size(current_database())::text AS bytes`.execute(
				db,
			);
			dbSizeBytes = size.rows[0] ? Number(size.rows[0].bytes) : null;
		} catch {
			dbSizeBytes = null;
		}

		let deliveries: {
			total: number;
			failed: number;
			dlq: number;
		} | null = null;
		try {
			const [counts, dead] = await Promise.all([
				db
					.selectFrom("subscription_deliveries")
					.select([
						db.fn.countAll<string>().as("total"),
						db.fn
							.count<string>(
								sql`CASE WHEN status_code IS NULL OR status_code >= 400 THEN 1 END`,
							)
							.as("failed"),
					])
					.where("dispatched_at", ">", sql<Date>`NOW() - INTERVAL '24 hours'`)
					.executeTakeFirst(),
				db
					.selectFrom("subscription_outbox")
					.select(db.fn.countAll<string>().as("n"))
					.where("status", "=", "dead")
					.executeTakeFirst(),
			]);
			deliveries = {
				total: Number(counts?.total ?? 0),
				failed: Number(counts?.failed ?? 0),
				dlq: Number(dead?.n ?? 0),
			};
		} catch {
			deliveries = null;
		}

		// Total rows processed over recent snapshots, bucketed hourly — the
		// overview sparkline. Per subgraph take the hour's max cumulative
		// counter, then sum across subgraphs. Sparse snapshots → fewer points.
		let rowsSeries: { t: string; rows: number }[] = [];
		try {
			const buckets = await sql<{ t: string; rows: string }>`
				SELECT t::text AS t, SUM(max_rows)::text AS rows
				FROM (
					SELECT date_trunc('hour', captured_at) AS t,
					       subgraph_id,
					       MAX(total_processed) AS max_rows
					FROM subgraph_health_snapshots
					WHERE captured_at > NOW() - INTERVAL '24 hours'
					GROUP BY 1, 2
				) s
				GROUP BY t
				ORDER BY t
			`.execute(db);
			rowsSeries = buckets.rows.map((b) => ({ t: b.t, rows: Number(b.rows) }));
		} catch {
			rowsSeries = [];
		}

		return c.json({
			uptime_s: uptimeSeconds,
			db_size_bytes: dbSizeBytes,
			deliveries_24h: deliveries,
			rows_series: rowsSeries,
		});
	});

	app.get("/", async (c) => {
		const mode = getInstanceMode();
		const features = INSTANCE_FEATURE_MANIFEST;
		try {
			const db = getDb();
			const instance = await getInstance(db);
			const subgraphs = await db
				.selectFrom("subgraphs")
				.select(["name", "status", "last_processed_block", "start_block"])
				.orderBy("name")
				.execute();
			const subscriptions = await db
				.selectFrom("subscriptions")
				.select(["name", "status", "kind"])
				.orderBy("name")
				.execute();
			return c.json({
				mode,
				network: instance?.network ?? process.env.STACKS_NETWORK ?? "mainnet",
				instance_id: instance?.id ?? null,
				features,
				subgraphs: subgraphs.map((row) => ({
					name: row.name,
					status: row.status,
					start_block: row.start_block,
					last_processed_block: row.last_processed_block,
				})),
				subscriptions: subscriptions.map((row) => ({
					name: row.name,
					status: row.status,
					kind: row.kind,
				})),
				console: {
					signup: false,
					pricing: false,
					publicDirectory: false,
				},
			});
		} catch {
			return c.json({
				mode,
				network: process.env.STACKS_NETWORK ?? "mainnet",
				instance_id: null,
				features,
				subgraphs: [],
				subscriptions: [],
				console: {
					signup: false,
					pricing: false,
					publicDirectory: false,
				},
			});
		}
	});

	return app;
}

export function renderLocalConsole(): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Secondlayer instance</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 44rem; padding: 0 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
    code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.5rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #ddd; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>This instance</h1>
  <p class="muted">Local catalog. No signup, no pricing, no public directory.</p>
  <div id="root">Loading…</div>
  <script>
    fetch("/v1/instance").then(r => r.json()).then(data => {
      const el = document.getElementById("root");
      const rows = (items, cols) => items.length
        ? "<table><thead><tr>" + cols.map(c => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
          items.map(item => "<tr>" + cols.map(c => "<td><code>" + (item[c] ?? "") + "</code></td>").join("") + "</tr>").join("") +
          "</tbody></table>"
        : "<p class=\\"muted\\">None yet.</p>";
      el.innerHTML =
        "<p>Network <code>" + data.network + "</code> · mode <code>" + data.mode + "</code></p>" +
        "<h2>Subgraphs</h2>" + rows(data.subgraphs, ["name", "status", "last_processed_block"]) +
        "<h2>Subscriptions</h2>" + rows(data.subscriptions, ["name", "status", "kind"]) +
        "<p class=\\"muted\\">JSON: <a href=\\"/v1/instance\\"><code>/v1/instance</code></a></p>";
    }).catch(err => {
      document.getElementById("root").textContent = String(err);
    });
  </script>
</body>
</html>`;
}
