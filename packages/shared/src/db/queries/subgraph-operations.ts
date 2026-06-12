import { type Kysely, sql } from "kysely";
import type {
	Database,
	SubgraphOperation,
	SubgraphOperationKind,
	SubgraphOperationStatus,
} from "../types.ts";

const ACTIVE_STATUSES: SubgraphOperationStatus[] = ["queued", "running"];

export function isActiveSubgraphOperationConflict(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const candidate = err as Error & {
		code?: string;
		constraint?: string;
		constraint_name?: string;
	};
	return (
		candidate.code === "23505" &&
		(candidate.constraint === "subgraph_operations_active_unique" ||
			candidate.constraint_name === "subgraph_operations_active_unique")
	);
}

export async function createSubgraphOperation(
	db: Kysely<Database>,
	data: {
		subgraphId: string;
		subgraphName: string;
		accountId?: string | null;
		kind: SubgraphOperationKind;
		fromBlock?: number;
		toBlock?: number;
		/** 'light' | 'heavy' — claim budgets heavy ops. DB default 'heavy'. */
		weight?: "light" | "heavy";
		estimatedEvents?: number | null;
	},
): Promise<SubgraphOperation> {
	return await db
		.insertInto("subgraph_operations")
		.values({
			subgraph_id: data.subgraphId,
			subgraph_name: data.subgraphName,
			account_id: data.accountId ?? null,
			kind: data.kind,
			from_block: data.fromBlock ?? null,
			to_block: data.toBlock ?? null,
			...(data.weight ? { weight: data.weight } : {}),
			estimated_events: data.estimatedEvents ?? null,
		})
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function findActiveSubgraphOperation(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<SubgraphOperation | null> {
	return (
		(await db
			.selectFrom("subgraph_operations")
			.selectAll()
			.where("subgraph_id", "=", subgraphId)
			.where("status", "in", ACTIVE_STATUSES)
			.orderBy("created_at", "asc")
			.executeTakeFirst()) ?? null
	);
}

export async function requestSubgraphOperationCancel(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<SubgraphOperation | null> {
	return (
		(await db
			.updateTable("subgraph_operations")
			.set({ cancel_requested: true, updated_at: new Date() })
			.where("subgraph_id", "=", subgraphId)
			.where("status", "in", ACTIVE_STATUSES)
			.returningAll()
			.executeTakeFirst()) ?? null
	);
}

export async function requestSubgraphOperationsCancelForDelete(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<SubgraphOperation[]> {
	return await db
		.updateTable("subgraph_operations")
		.set({ cancel_requested: true, updated_at: new Date() })
		.where("subgraph_id", "=", subgraphId)
		.where("status", "in", ACTIVE_STATUSES)
		.returningAll()
		.execute();
}

/**
 * Poll until no active subgraph operations remain for the subgraph or until
 * `timeoutMs` elapses. Returns true if all active operations cleared, false
 * if we timed out. Callers should use this before `DROP SCHEMA` so the active
 * processor has a chance to observe `cancel_requested` and release its row /
 * advisory locks. Without this, the DROP blocks behind the live transaction
 * and the API socket times out before the lock releases.
 */
export async function waitForSubgraphOperationsClear(
	db: Kysely<Database>,
	subgraphId: string,
	opts?: { timeoutMs?: number; pollMs?: number },
): Promise<boolean> {
	const timeoutMs = opts?.timeoutMs ?? 30_000;
	const pollMs = opts?.pollMs ?? 500;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const active = await db
			.selectFrom("subgraph_operations")
			.select("id")
			.where("subgraph_id", "=", subgraphId)
			.where("status", "in", ACTIVE_STATUSES)
			.limit(1)
			.executeTakeFirst();
		if (!active) return true;
		await new Promise((r) => setTimeout(r, pollMs));
	}
	return false;
}

/** Max concurrently-running 'heavy' ops (broad/non-sparse syncs). */
function resolveHeavyOpBudget(): number {
	const parsed = Number.parseInt(
		process.env.SUBGRAPH_HEAVY_OP_BUDGET ?? "2",
		10,
	);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

export async function claimSubgraphOperation(
	db: Kysely<Database>,
	lockedBy: string,
): Promise<SubgraphOperation | null> {
	// Fair queue: accounts with fewer currently-running operations are served first,
	// breaking ties by creation time. Prevents one user's long reindex from
	// starving other accounts when SUBGRAPH_OPERATION_CONCURRENCY > 1.
	const heavyBudget = resolveHeavyOpBudget();
	const result = await sql<SubgraphOperation>`
		UPDATE subgraph_operations
		SET
			status = 'running',
			locked_by = ${lockedBy},
			locked_until = now() + interval '60 seconds',
			started_at = COALESCE(started_at, now()),
			updated_at = now()
		WHERE id = (
			SELECT so.id
			FROM subgraph_operations so
			LEFT JOIN (
				SELECT account_id, COUNT(*) AS cnt
				FROM subgraph_operations
				WHERE status = 'running'
				GROUP BY account_id
			) rc ON so.account_id = rc.account_id
			LEFT JOIN accounts a ON a.id::text = so.account_id
			WHERE
				(
					so.status = 'queued'
					OR (
						so.status = 'running'
						AND (so.locked_until IS NULL OR so.locked_until < now())
					)
				)
				-- Heavy budget as an eligibility FILTER (not a post-claim refusal):
				-- a budget-blocked heavy op at the head must not starve the light
				-- ops behind it. Live-lock condition (locked_until > now()) keeps a
				-- STALE heavy op from blocking its own reclaim. Soft across
				-- concurrent claimers (can overshoot by one with multiple runners) —
				-- acceptable for the single-runner deployment.
				AND (
					so.weight = 'light'
					OR (
						SELECT COUNT(*)
						FROM subgraph_operations h
						WHERE h.status = 'running'
							AND h.weight = 'heavy'
							AND h.locked_until > now()
							AND h.id != so.id
					) < ${heavyBudget}
				)
			ORDER BY
				COALESCE(rc.cnt, 0) ASC,
				CASE COALESCE(a.plan, 'none')
					WHEN 'enterprise' THEN 0
					WHEN 'scale' THEN 1
					WHEN 'launch' THEN 2
					ELSE 3
				END,
				CASE WHEN so.status = 'queued' THEN 0 ELSE 1 END,
				so.created_at ASC
			FOR UPDATE OF so SKIP LOCKED
			LIMIT 1
		)
		RETURNING *
	`.execute(db);
	return result.rows[0] ?? null;
}

export async function heartbeatSubgraphOperation(
	db: Kysely<Database>,
	operationId: string,
	lockedBy: string,
): Promise<void> {
	await db
		.updateTable("subgraph_operations")
		.set({
			locked_until: sql<Date>`now() + interval '60 seconds'`,
			updated_at: new Date(),
		})
		.where("id", "=", operationId)
		.where("status", "=", "running")
		.where("locked_by", "=", lockedBy)
		.execute();
}

export async function getSubgraphOperation(
	db: Kysely<Database>,
	operationId: string,
): Promise<SubgraphOperation | null> {
	return (
		(await db
			.selectFrom("subgraph_operations")
			.selectAll()
			.where("id", "=", operationId)
			.executeTakeFirst()) ?? null
	);
}

/** Recent operations for a subgraph, newest first (for the status read API). */
export async function listSubgraphOperations(
	db: Kysely<Database>,
	subgraphId: string,
	limit = 20,
): Promise<SubgraphOperation[]> {
	return db
		.selectFrom("subgraph_operations")
		.selectAll()
		.where("subgraph_id", "=", subgraphId)
		.orderBy("created_at", "desc")
		.limit(limit)
		.execute();
}

export async function completeSubgraphOperation(
	db: Kysely<Database>,
	operationId: string,
	lockedBy: string,
	processedBlocks: number,
): Promise<void> {
	await db
		.updateTable("subgraph_operations")
		.set({
			status: "completed",
			finished_at: new Date(),
			processed_blocks: processedBlocks,
			locked_by: null,
			locked_until: null,
			updated_at: new Date(),
		})
		.where("id", "=", operationId)
		.where("locked_by", "=", lockedBy)
		.execute();
}

export async function cancelSubgraphOperation(
	db: Kysely<Database>,
	operationId: string,
	lockedBy: string,
	processedBlocks: number,
): Promise<void> {
	await db
		.updateTable("subgraph_operations")
		.set({
			status: "cancelled",
			finished_at: new Date(),
			processed_blocks: processedBlocks,
			locked_by: null,
			locked_until: null,
			updated_at: new Date(),
		})
		.where("id", "=", operationId)
		.where("locked_by", "=", lockedBy)
		.execute();
}

export async function failSubgraphOperation(
	db: Kysely<Database>,
	operationId: string,
	lockedBy: string,
	error: string,
	processedBlocks?: number,
): Promise<void> {
	await db
		.updateTable("subgraph_operations")
		.set({
			status: "failed",
			finished_at: new Date(),
			processed_blocks: processedBlocks ?? null,
			error,
			locked_by: null,
			locked_until: null,
			updated_at: new Date(),
		})
		.where("id", "=", operationId)
		.where("locked_by", "=", lockedBy)
		.execute();
}

/**
 * 1-based position of a queued operation under the claim ordering (fairness →
 * plan rank → queued-first → FIFO). The heavy-budget admission filter is NOT
 * applied — a heavy op's eligibility depends on runtime budget state — so the
 * position is approximate; render it as "~N". Returns null unless queued.
 */
export async function getOperationQueuePosition(
	db: Kysely<Database>,
	operationId: string,
): Promise<number | null> {
	const result = await sql<{ rn: string | number }>`
		WITH candidates AS (
			SELECT
				so.id,
				ROW_NUMBER() OVER (
					ORDER BY
						COALESCE(rc.cnt, 0) ASC,
						CASE COALESCE(a.plan, 'none')
							WHEN 'enterprise' THEN 0
							WHEN 'scale' THEN 1
							WHEN 'launch' THEN 2
							ELSE 3
						END,
						CASE WHEN so.status = 'queued' THEN 0 ELSE 1 END,
						so.created_at ASC
				) AS rn
			FROM subgraph_operations so
			LEFT JOIN (
				SELECT account_id, COUNT(*) AS cnt
				FROM subgraph_operations
				WHERE status = 'running'
				GROUP BY account_id
			) rc ON so.account_id = rc.account_id
			LEFT JOIN accounts a ON a.id::text = so.account_id
			WHERE so.status = 'queued'
		)
		SELECT rn FROM candidates WHERE id = ${operationId}
	`.execute(db);
	const rn = result.rows[0]?.rn;
	return rn == null ? null : Number(rn);
}

/** Median duration (seconds) of the last 20 completed ops of a weight class —
 *  the "est. start" multiplier for queued positions. Null with no history. */
export async function getRecentOperationMedianDuration(
	db: Kysely<Database>,
	weight: "light" | "heavy",
): Promise<number | null> {
	const result = await sql<{ median: string | number | null }>`
		SELECT percentile_cont(0.5) WITHIN GROUP (
			ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))
		) AS median
		FROM (
			SELECT started_at, finished_at
			FROM subgraph_operations
			WHERE status = 'completed'
				AND weight = ${weight}
				AND started_at IS NOT NULL
				AND finished_at IS NOT NULL
			ORDER BY finished_at DESC
			LIMIT 20
		) recent
	`.execute(db);
	const median = result.rows[0]?.median;
	return median == null ? null : Number(median);
}

/** Progress-flush hook: events processed so far on a running operation. */
export async function updateOperationProcessedEvents(
	db: Kysely<Database>,
	operationId: string,
	processedEvents: number,
): Promise<void> {
	await db
		.updateTable("subgraph_operations")
		.set({ processed_events: processedEvents, updated_at: new Date() })
		.where("id", "=", operationId)
		.execute();
}
