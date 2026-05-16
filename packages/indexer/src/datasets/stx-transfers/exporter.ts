import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../_shared/exporter.ts";
import { exportDatasetRange } from "../_shared/exporter.ts";
import { writeStxTransfersParquet } from "./file.ts";
import { type StxTransferRow, readCanonicalStxTransferRows } from "./query.ts";
import {
	STX_TRANSFERS_DATASET,
	STX_TRANSFERS_SCHEMA_VERSION,
	STX_TRANSFERS_VERSION,
	createStxTransfersSchemaDocument,
} from "./schema.ts";

export const stxTransfersExporterSpec: DatasetExporterSpec<StxTransferRow> = {
	dataset: STX_TRANSFERS_DATASET,
	version: STX_TRANSFERS_VERSION,
	schemaVersion: STX_TRANSFERS_SCHEMA_VERSION,
	readRows: readCanonicalStxTransferRows,
	writeParquet: writeStxTransfersParquet,
	buildSchemaDocument: createStxTransfersSchemaDocument,
};

export type ExportStxTransfersRangeOptions = ExportDatasetRangeOptions;
export type ExportStxTransfersRangeResult = ExportDatasetRangeResult;

export function exportStxTransfersRange(
	options: ExportStxTransfersRangeOptions,
): Promise<ExportStxTransfersRangeResult> {
	return exportDatasetRange(stxTransfersExporterSpec, options);
}
