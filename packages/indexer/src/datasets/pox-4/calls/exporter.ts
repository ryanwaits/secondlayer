import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { buildSchemaDocument } from "../../_shared/parquet.ts";
import { writePox4CallsParquet } from "./file.ts";
import { type Pox4CallParquetRow, readCanonicalPox4CallRows } from "./query.ts";
import {
	POX4_CALLS_DATASET,
	POX4_CALLS_SCHEMA_COLUMNS,
	POX4_CALLS_SCHEMA_VERSION,
	POX4_CALLS_VERSION,
} from "./schema.ts";

export const pox4CallsExporterSpec: DatasetExporterSpec<Pox4CallParquetRow> = {
	dataset: POX4_CALLS_DATASET,
	version: POX4_CALLS_VERSION,
	schemaVersion: POX4_CALLS_SCHEMA_VERSION,
	readRows: readCanonicalPox4CallRows,
	writeParquet: writePox4CallsParquet,
	buildSchemaDocument: (network) =>
		buildSchemaDocument({
			dataset: POX4_CALLS_DATASET,
			version: POX4_CALLS_VERSION,
			schemaVersion: POX4_CALLS_SCHEMA_VERSION,
			network,
			columns: POX4_CALLS_SCHEMA_COLUMNS,
		}),
};

export type ExportPox4CallsRangeOptions = ExportDatasetRangeOptions;
export type ExportPox4CallsRangeResult = ExportDatasetRangeResult;

export function exportPox4CallsRange(
	options: ExportPox4CallsRangeOptions,
): Promise<ExportPox4CallsRangeResult> {
	return exportDatasetRange(pox4CallsExporterSpec, options);
}
