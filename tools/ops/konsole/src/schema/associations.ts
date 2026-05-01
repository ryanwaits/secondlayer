import type { SchemaInfo } from "./types.ts";

export type AssociationType =
	| "belongs_to"
	| "has_many"
	| "has_one"
	| "has_many_through";

export interface AssociationDef {
	type: AssociationType;
	name: string;
	fromTable: string;
	toTable: string;
	foreignKey: string;
	through?: string; // join table name for has_many_through
}

export interface AssociationMap {
	/** table name → associations on that table */
	[tableName: string]: AssociationDef[];
}

/**
 * Detect join tables: exactly 2 FK columns + at most 2 extra non-PK columns.
 */
function findJoinTables(schema: SchemaInfo): Set<string> {
	const joinTables = new Set<string>();
	const fksByTable = new Map<
		string,
		{ fromColumn: string; toTable: string }[]
	>();

	for (const fk of schema.foreignKeys) {
		if (!fksByTable.has(fk.fromTable)) fksByTable.set(fk.fromTable, []);
		fksByTable
			.get(fk.fromTable)
			?.push({ fromColumn: fk.fromColumn, toTable: fk.toTable });
	}

	for (const [tableName, fks] of fksByTable) {
		if (fks.length !== 2) continue;
		const table = schema.tables.get(tableName);
		if (!table) continue;

		const fkCols = new Set(fks.map((f) => f.fromColumn));
		const extraCols = table.columns.filter(
			(c) => !fkCols.has(c.name) && !c.isPrimaryKey,
		);
		if (extraCols.length <= 2) {
			joinTables.add(tableName);
		}
	}
	return joinTables;
}

export function inferAssociations(schema: SchemaInfo): AssociationMap {
	const map: AssociationMap = {};
	const ensure = (t: string) => {
		if (!map[t]) map[t] = [];
	};

	const joinTables = findJoinTables(schema);

	// Index FKs by table for through-association lookup
	const fksByTable = new Map<
		string,
		{ fromColumn: string; toTable: string }[]
	>();
	for (const fk of schema.foreignKeys) {
		if (!fksByTable.has(fk.fromTable)) fksByTable.set(fk.fromTable, []);
		fksByTable
			.get(fk.fromTable)
			?.push({ fromColumn: fk.fromColumn, toTable: fk.toTable });
	}

	for (const fk of schema.foreignKeys) {
		const fromTable = schema.tables.get(fk.fromTable);
		const toTable = schema.tables.get(fk.toTable);
		if (!fromTable || !toTable) continue;

		// Skip join tables for direct belongs_to/has_many (they get has_many_through instead)
		if (joinTables.has(fk.fromTable)) continue;

		// belongs_to: the table with the FK column
		const belongsName = fk.fromColumn.replace(/_id$/, "");
		ensure(fk.fromTable);
		map[fk.fromTable].push({
			type: "belongs_to",
			name: belongsName,
			fromTable: fk.fromTable,
			toTable: fk.toTable,
			foreignKey: fk.fromColumn,
		});

		// has_many or has_one: inverse — does the FK column have a UNIQUE constraint?
		const isUnique = fromTable.uniqueColumns.has(fk.fromColumn);
		const inverseName = isUnique
			? fk.fromTable.replace(/s$/, "")
			: fk.fromTable;
		ensure(fk.toTable);
		map[fk.toTable].push({
			type: isUnique ? "has_one" : "has_many",
			name: inverseName,
			fromTable: fk.toTable,
			toTable: fk.fromTable,
			foreignKey: fk.fromColumn,
		});
	}

	// has_many_through via join tables
	for (const joinTable of joinTables) {
		const fks = fksByTable.get(joinTable);
		if (!fks || fks.length !== 2) continue;

		const [a, b] = fks;
		// A has_many B through joinTable, and vice versa
		ensure(a.toTable);
		map[a.toTable].push({
			type: "has_many_through",
			name: b.toTable,
			fromTable: a.toTable,
			toTable: b.toTable,
			foreignKey: a.fromColumn,
			through: joinTable,
		});

		ensure(b.toTable);
		map[b.toTable].push({
			type: "has_many_through",
			name: a.toTable,
			fromTable: b.toTable,
			toTable: a.toTable,
			foreignKey: b.fromColumn,
			through: joinTable,
		});
	}

	return map;
}
