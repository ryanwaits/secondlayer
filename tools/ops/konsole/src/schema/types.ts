export interface ColumnInfo {
	name: string;
	dataType: string;
	nullable: boolean;
	hasDefault: boolean;
	isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
}

export interface TableInfo {
	name: string;
	columns: ColumnInfo[];
	primaryKey: string;
	uniqueColumns: Set<string>;
}

export interface SchemaInfo {
	tables: Map<string, TableInfo>;
	foreignKeys: ForeignKeyInfo[];
}
