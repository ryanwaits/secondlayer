export type Row = globalThis.Record<string, unknown>;

export interface Model {
	_table: string;
	_primaryKey: string;
	_columns: string[];
	all: import("./query-chain.ts").QueryChain;
	first: import("./query-chain.ts").QueryChain;
	last: import("./query-chain.ts").QueryChain;
	count: Promise<number>;
	where(
		columnOrConditions: string | Row,
		value?: unknown,
	): import("./query-chain.ts").QueryChain;
	not(conditions: Row): import("./query-chain.ts").QueryChain;
	find(id: string | number): Promise<import("./record.ts").Record | null>;
	findBy(conditions: Row): Promise<import("./record.ts").Record | null>;
	pluck(column: string): Promise<unknown[]>;
	create(attrs: Row): Promise<import("./record.ts").Record>;
	order(
		column: string,
		direction?: "asc" | "desc",
	): import("./query-chain.ts").QueryChain;
	limit(n: number): import("./query-chain.ts").QueryChain;
	joins(...names: string[]): import("./query-chain.ts").QueryChain;
	leftJoins(...names: string[]): import("./query-chain.ts").QueryChain;
	exists(conditions?: Row): Promise<boolean>;
	// Dynamic finders via proxy: findByEmail("x"), findByPlanAndEmail("pro", "x")
	[key: string]: unknown;
}

export type ModelRegistry = globalThis.Record<string, Model>;
