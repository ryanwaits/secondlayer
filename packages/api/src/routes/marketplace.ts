import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ipRateLimit, requireAuth } from "@secondlayer/auth";
import { getErrorMessage } from "@secondlayer/shared";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import {
	getCreatorProfile,
	getPublicSubgraph,
	getSubgraphQueryTotal,
	getSubgraphUsageHistory,
	incrementSubgraphQueryCount,
	listPublicSubgraphs,
} from "@secondlayer/shared/db/queries/marketplace";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { getApiKeyId } from "../lib/ownership.ts";
import { cache } from "./subgraphs.ts";
import {
	InvalidColumnError,
	buildWhereConditions,
	getSubgraphSchema,
	getValidColumns,
	ident,
	parseQueryParams,
	subgraphSchemaName,
} from "./subgraph-query-helpers.ts";

const app = new Hono();

async function query(text: string, params: unknown[] = []) {
	const client = getRawClient();
	return client.unsafe(text, params as any[]);
}

// ── Browse public subgraphs ─────────────────────────────────────────────

app.get("/subgraphs", async (c) => {
	const params = c.req.query();
	const tags = params.tags ? params.tags.split(",").map((t) => t.trim()) : undefined;

	const db = getDb();
	const result = await listPublicSubgraphs(db, {
		limit: params._limit ? Number.parseInt(params._limit, 10) : undefined,
		offset: params._offset ? Number.parseInt(params._offset, 10) : undefined,
		tags,
		search: params.search,
		sort: params._sort as "recent" | "popular" | "name" | undefined,
	});

	// Enrich with table names from definition
	const data = result.data.map((row) => {
		const def = row.definition as Record<string, unknown> | null;
		const schema = (def?.schema ?? {}) as Record<string, unknown>;
		const startBlock = row.start_block ?? 0;

		return {
			name: row.name,
			description: row.description,
			tags: row.tags,
			creator: {
				displayName: row.display_name,
				slug: row.slug,
			},
			status: row.status,
			version: row.version,
			tables: Object.keys(schema),
			totalQueries7d: (row as any).queries_7d ?? 0,
			forkCount: (row as any).fork_count ?? 0,
			forkedFrom: !!(row as any).forked_from_id,
			totalProcessed: row.total_processed,
			progress:
				row.last_processed_block > startBlock
					? Math.min(1, row.last_processed_block / Math.max(1, startBlock + 1))
					: 0,
			createdAt: row.created_at.toISOString(),
		};
	});

	return c.json({ data, meta: result.meta });
});

// ── Public subgraph detail ──────────────────────────────────────────────

app.get("/subgraphs/:name", async (c) => {
	const { name } = c.req.param();

	// Try cache first
	let subgraph = cache.getPublicByName(name);
	if (!subgraph) {
		// Fall back to DB
		const row = await getPublicSubgraph(getDb(), name);
		if (!row) {
			return c.json({ error: "Subgraph not found", code: "NOT_FOUND" }, 404);
		}
		subgraph = row;
	}

	const subgraphSchema = getSubgraphSchema(subgraph);
	const sn = subgraphSchemaName(subgraph);
	const schemaEntries = Object.entries(subgraphSchema);

	// Fetch row counts + usage in parallel
	const db = getDb();
	const [countResults, usage7d, usage30d, usageDaily, creatorRow, forkedFromRow, forkCountRow] =
		await Promise.all([
			Promise.allSettled(
				schemaEntries.map(([tableName]) =>
					query(
						`SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`,
					).then((r) => Number.parseInt(String(r[0]?.count ?? 0), 10)),
				),
			),
			getSubgraphQueryTotal(db, subgraph.id, 7),
			getSubgraphQueryTotal(db, subgraph.id, 30),
			getSubgraphUsageHistory(db, subgraph.id, 30),
			db
				.selectFrom("api_keys")
				.innerJoin("accounts", "accounts.id", "api_keys.account_id")
				.select([
					"accounts.display_name",
					"accounts.slug",
					"accounts.bio",
					"accounts.avatar_url",
				])
				.where("api_keys.id", "=", subgraph.api_key_id)
				.executeTakeFirst(),
			// Resolve forked_from_id to source name
			subgraph.forked_from_id
				? db
						.selectFrom("subgraphs")
						.select(["id", "name"])
						.where("id", "=", subgraph.forked_from_id)
						.executeTakeFirst()
				: Promise.resolve(null),
			// Count forks of this subgraph
			db
				.selectFrom("subgraphs")
				.select(db.fn.countAll<number>().as("count"))
				.where("forked_from_id", "=", subgraph.id)
				.executeTakeFirst(),
		]);

	const tableSchemas: Record<string, any> = {};
	for (let i = 0; i < schemaEntries.length; i++) {
		const [tableName, tableDef] = schemaEntries[i];
		const cr = countResults[i];
		const rowCount = cr.status === "fulfilled" ? cr.value : 0;

		const columns: Record<string, any> = {};
		for (const [colName, col] of Object.entries(tableDef.columns)) {
			columns[colName] = {
				type: col.type,
				...(col.nullable && { nullable: true }),
			};
		}
		columns._id = { type: "serial" };
		columns._block_height = { type: "bigint" };
		columns._tx_id = { type: "text" };
		columns._created_at = { type: "timestamp" };

		tableSchemas[tableName] = {
			columns,
			rowCount,
			endpoint: `/api/marketplace/subgraphs/${name}/${tableName}`,
		};
	}

	const def = subgraph.definition as Record<string, unknown> | null;

	return c.json({
		name: subgraph.name,
		description: subgraph.description,
		tags: subgraph.tags,
		creator: {
			displayName: creatorRow?.display_name ?? null,
			slug: creatorRow?.slug ?? null,
		},
		status: subgraph.status,
		version: subgraph.version,
		tables: Object.keys(subgraphSchema),
		startBlock: subgraph.start_block,
		lastProcessedBlock: subgraph.last_processed_block,
		forkedFrom: forkedFromRow ? { id: forkedFromRow.id, name: forkedFromRow.name } : null,
		forkCount: Number(forkCountRow?.count ?? 0),
		sources: def?.sources ?? null,
		tableSchemas,
		usage: {
			totalQueries7d: usage7d,
			totalQueries30d: usage30d,
			daily: usageDaily.map((d) => ({
				date: d.date,
				count: d.query_count,
			})),
		},
		createdAt: subgraph.created_at.toISOString(),
		updatedAt: subgraph.updated_at.toISOString(),
	});
});

// ── Query public subgraph data ──────────────────────────────────────────

app.get("/subgraphs/:name/:tableName", ipRateLimit(30), async (c) => {
	const { name, tableName } = c.req.param();

	const subgraph = cache.getPublicByName(name);
	if (!subgraph) {
		return c.json({ error: "Subgraph not found", code: "NOT_FOUND" }, 404);
	}

	const subgraphSchema = getSubgraphSchema(subgraph);
	const tableDef = subgraphSchema[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}

	const validColumns = getValidColumns(tableDef);

	try {
		const parsed = parseQueryParams(c.req.query(), validColumns, tableDef);
		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];

		const selectFields = parsed.fields
			? parsed.fields.map((f) => ident(f)).join(", ")
			: "*";

		let text = `SELECT ${selectFields} FROM ${ident(sn)}.${ident(tableName)}`;

		const conditions = buildWhereConditions(parsed, params);
		if (conditions.length > 0) {
			text += ` WHERE ${conditions.join(" AND ")}`;
		}

		const sortCol = parsed.sort ? ident(parsed.sort) : '"_id"';
		text += ` ORDER BY ${sortCol} ${parsed.order}`;
		text += ` LIMIT ${parsed.limit} OFFSET ${parsed.offset}`;

		const countParams: unknown[] = [];
		const countConditions = buildWhereConditions(parsed, countParams);
		let countText = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;
		if (countConditions.length > 0) {
			countText += ` WHERE ${countConditions.join(" AND ")}`;
		}

		const [data, countResult] = await Promise.all([
			query(text, params),
			query(countText, countParams),
		]);

		// Fire-and-forget usage tracking
		const db = getDb();
		incrementSubgraphQueryCount(db, subgraph.id).catch(() => {});

		return c.json({
			data: Array.from(data),
			meta: {
				total: Number.parseInt(String(countResult[0]?.count ?? 0), 10),
				limit: parsed.limit,
				offset: parsed.offset,
			},
		});
	} catch (e) {
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
});

// ── Creator profile ─────────────────────────────────────────────────────

app.get("/creators/:slug", async (c) => {
	const { slug } = c.req.param();
	const db = getDb();
	const result = await getCreatorProfile(db, slug);

	if (!result) {
		return c.json({ error: "Creator not found", code: "NOT_FOUND" }, 404);
	}

	const { account, subgraphs } = result;

	return c.json({
		displayName: account.display_name,
		bio: account.bio,
		avatarUrl: account.avatar_url,
		slug: account.slug,
		subgraphs: subgraphs.map((row) => {
			const def = row.definition as Record<string, unknown> | null;
			const schema = (def?.schema ?? {}) as Record<string, unknown>;
			return {
				name: row.name,
				description: row.description,
				tags: row.tags,
				status: row.status,
				version: row.version,
				tables: Object.keys(schema),
				totalQueries7d: (row as any).queries_7d ?? 0,
				createdAt: row.created_at.toISOString(),
			};
		}),
	});
});

// ── Fork a public subgraph (auth required) ────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "./data";

app.post("/subgraphs/:name/fork", requireAuth(), async (c) => {
	const { name } = c.req.param();
	const db = getDb();

	// Parse optional body
	let newName = name;
	try {
		const body = await c.req.json();
		if (body?.newName) newName = body.newName;
	} catch {
		// No body or invalid JSON — use source name as default
	}

	// Validate new name format
	if (!/^[a-z0-9-]+$/.test(newName) || newName.length > 63) {
		return c.json(
			{ error: "Name must be lowercase alphanumeric + hyphens, max 63 chars" },
			400,
		);
	}

	// Look up source — must be public
	const source = await getPublicSubgraph(db, name);
	if (!source) {
		return c.json({ error: "Subgraph not found", code: "NOT_FOUND" }, 404);
	}

	// Verify source handler exists on disk
	if (!source.handler_path || !existsSync(source.handler_path)) {
		return c.json(
			{ error: "Source handler file missing", code: "INTERNAL_ERROR" },
			500,
		);
	}

	// Auth context
	const apiKeyId = getApiKeyId(c);
	const apiKey = (c as any).get("apiKey");
	const keyPrefix = apiKey?.key_prefix;

	// Name collision check
	const existing = await getSubgraph(db, newName, apiKeyId);
	if (existing) {
		return c.json(
			{ error: `Subgraph "${newName}" already exists` },
			409,
		);
	}

	// Copy handler file
	const subgraphsDir = join(DATA_DIR, "subgraphs");
	const newHandlerPath = join(subgraphsDir, `${newName}.js`);
	try {
		copyFileSync(source.handler_path, newHandlerPath);
	} catch (err) {
		return c.json(
			{ error: `Failed to copy handler: ${getErrorMessage(err)}` },
			500,
		);
	}

	// Import the copied handler to get definition
	let def: any;
	try {
		const mod = await import(`${newHandlerPath}?t=${Date.now()}`);
		def = mod.default ?? mod;
	} catch (err) {
		return c.json(
			{ error: `Failed to load handler: ${getErrorMessage(err)}` },
			500,
		);
	}

	// Override name in definition for the fork
	def.name = newName;

	// Deploy schema (creates PG schema + tables + registers subgraph)
	const schemaName = keyPrefix
		? pgSchemaName(newName, keyPrefix)
		: pgSchemaName(newName);

	const { deploySchema } = await import("@secondlayer/subgraphs");
	const result = await deploySchema(db, def, newHandlerPath, {
		apiKeyId,
		schemaName,
	});

	// Set forked_from_id (deploySchema doesn't thread this)
	await db
		.updateTable("subgraphs")
		.set({ forked_from_id: source.id })
		.where("id", "=", result.subgraphId)
		.execute();

	await cache.refresh();

	// Auto-start indexing
	if (result.action === "created") {
		(async () => {
			try {
				const { reindexSubgraph } = await import("@secondlayer/subgraphs");
				await reindexSubgraph(def, { schemaName });
			} catch (err) {
				console.error(
					`Auto-reindex failed for fork ${newName}: ${getErrorMessage(err)}`,
				);
			}
		})();
	}

	return c.json(
		{
			action: "forked",
			subgraphId: result.subgraphId,
			name: newName,
			forkedFrom: name,
		},
		201,
	);
});

export default app;
