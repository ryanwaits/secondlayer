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

export async function claimSubgraphOperation(
	db: Kysely<Database>,
	lockedBy: string,
): Promise<SubgraphOperation | null> {
	// Fair queue: accounts with fewer currently-running operations are served first,
	// breaking ties by creation time. Prevents one user's long reindex from
	// starving other accounts when SUBGRAPH_OPERATION_CONCURRENCY > 1.
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
			WHERE
				so.status = 'queued'
				OR (
					so.status = 'running'
					AND (so.locked_until IS NULL OR so.locked_until < now())
				)
			ORDER BY
				COALESCE(rc.cnt, 0) ASC,
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
