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

export async function claimSubgraphOperation(
	db: Kysely<Database>,
	lockedBy: string,
): Promise<SubgraphOperation | null> {
	const result = await sql<SubgraphOperation>`
		UPDATE subgraph_operations
		SET
			status = 'running',
			locked_by = ${lockedBy},
			locked_until = now() + interval '60 seconds',
			started_at = COALESCE(started_at, now()),
			updated_at = now()
		WHERE id = (
			SELECT id
			FROM subgraph_operations
			WHERE
				status = 'queued'
				OR (
					status = 'running'
					AND (locked_until IS NULL OR locked_until < now())
				)
			ORDER BY
				CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
				created_at
			FOR UPDATE SKIP LOCKED
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
