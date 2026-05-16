import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

export type DatasetParquetColumnType = "string" | "int32" | "int64" | "boolean";

export type DatasetParquetColumn = {
	name: string;
	type: DatasetParquetColumnType;
	nullable: boolean;
	description: string;
};

const STRING_FIELD = { type: "UTF8", compression: "SNAPPY" } as const;
const INT32_FIELD = { type: "INT32", compression: "SNAPPY" } as const;
const INT64_FIELD = { type: "INT64", compression: "SNAPPY" } as const;
const BOOLEAN_FIELD = { type: "BOOLEAN", compression: "SNAPPY" } as const;

function fieldFor(column: DatasetParquetColumn) {
	const base =
		column.type === "string"
			? STRING_FIELD
			: column.type === "int32"
				? INT32_FIELD
				: column.type === "int64"
					? INT64_FIELD
					: BOOLEAN_FIELD;
	return column.nullable ? { ...base, optional: true } : base;
}

export function buildParquetSchema(
	columns: readonly DatasetParquetColumn[],
): ParquetSchema {
	const def: Record<string, ReturnType<typeof fieldFor>> = {};
	for (const column of columns) {
		def[column.name] = fieldFor(column);
	}
	return new ParquetSchema(def);
}

export async function writeParquetFromColumns<Row>(params: {
	outputPath: string;
	rows: readonly Row[];
	columns: readonly DatasetParquetColumn[];
	metadata?: Record<string, string>;
	rowGroupSize?: number;
}): Promise<void> {
	await mkdir(dirname(params.outputPath), { recursive: true });
	const writer = await ParquetWriter.openFile(
		buildParquetSchema(params.columns),
		params.outputPath,
		{ rowGroupSize: params.rowGroupSize ?? 5_000 },
	);
	for (const [key, value] of Object.entries(params.metadata ?? {})) {
		writer.setMetadata(key, value);
	}
	try {
		for (const row of params.rows) {
			const record: Record<string, unknown> = {};
			for (const column of params.columns) {
				record[column.name] = (row as Record<string, unknown>)[column.name];
			}
			await writer.appendRow(record);
		}
	} finally {
		await writer.close();
	}
}

export type SchemaDocument<Dataset extends string, Version extends string> = {
	dataset: Dataset;
	version: Version;
	schema_version: number;
	network: string;
	columns: readonly DatasetParquetColumn[];
};

export function buildSchemaDocument<
	Dataset extends string,
	Version extends string,
>(params: {
	dataset: Dataset;
	version: Version;
	schemaVersion: number;
	network: string;
	columns: readonly DatasetParquetColumn[];
}): SchemaDocument<Dataset, Version> {
	return {
		dataset: params.dataset,
		version: params.version,
		schema_version: params.schemaVersion,
		network: params.network,
		columns: params.columns,
	};
}
