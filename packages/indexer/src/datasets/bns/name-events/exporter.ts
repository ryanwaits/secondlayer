import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { buildSchemaDocument } from "../../_shared/parquet.ts";
import { writeBnsNameEventsParquet } from "./file.ts";
import {
	type BnsNameEventParquetRow,
	readCanonicalBnsNameEventRows,
} from "./query.ts";
import {
	BNS_NAME_EVENTS_DATASET,
	BNS_NAME_EVENTS_SCHEMA_COLUMNS,
	BNS_NAME_EVENTS_SCHEMA_VERSION,
	BNS_NAME_EVENTS_VERSION,
} from "./schema.ts";

export const bnsNameEventsExporterSpec: DatasetExporterSpec<BnsNameEventParquetRow> =
	{
		dataset: BNS_NAME_EVENTS_DATASET,
		version: BNS_NAME_EVENTS_VERSION,
		schemaVersion: BNS_NAME_EVENTS_SCHEMA_VERSION,
		readRows: readCanonicalBnsNameEventRows,
		writeParquet: writeBnsNameEventsParquet,
		buildSchemaDocument: (network) =>
			buildSchemaDocument({
				dataset: BNS_NAME_EVENTS_DATASET,
				version: BNS_NAME_EVENTS_VERSION,
				schemaVersion: BNS_NAME_EVENTS_SCHEMA_VERSION,
				network,
				columns: BNS_NAME_EVENTS_SCHEMA_COLUMNS,
			}),
	};

export type ExportBnsNameEventsRangeOptions = ExportDatasetRangeOptions;
export type ExportBnsNameEventsRangeResult = ExportDatasetRangeResult;

export function exportBnsNameEventsRange(
	options: ExportBnsNameEventsRangeOptions,
): Promise<ExportBnsNameEventsRangeResult> {
	return exportDatasetRange(bnsNameEventsExporterSpec, options);
}
