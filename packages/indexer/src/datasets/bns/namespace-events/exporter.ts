import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { buildSchemaDocument } from "../../_shared/parquet.ts";
import { writeBnsNamespaceEventsParquet } from "./file.ts";
import {
	type BnsNamespaceEventParquetRow,
	readCanonicalBnsNamespaceEventRows,
} from "./query.ts";
import {
	BNS_NAMESPACE_EVENTS_DATASET,
	BNS_NAMESPACE_EVENTS_SCHEMA_COLUMNS,
	BNS_NAMESPACE_EVENTS_SCHEMA_VERSION,
	BNS_NAMESPACE_EVENTS_VERSION,
} from "./schema.ts";

export const bnsNamespaceEventsExporterSpec: DatasetExporterSpec<BnsNamespaceEventParquetRow> =
	{
		dataset: BNS_NAMESPACE_EVENTS_DATASET,
		version: BNS_NAMESPACE_EVENTS_VERSION,
		schemaVersion: BNS_NAMESPACE_EVENTS_SCHEMA_VERSION,
		readRows: readCanonicalBnsNamespaceEventRows,
		writeParquet: writeBnsNamespaceEventsParquet,
		buildSchemaDocument: (network) =>
			buildSchemaDocument({
				dataset: BNS_NAMESPACE_EVENTS_DATASET,
				version: BNS_NAMESPACE_EVENTS_VERSION,
				schemaVersion: BNS_NAMESPACE_EVENTS_SCHEMA_VERSION,
				network,
				columns: BNS_NAMESPACE_EVENTS_SCHEMA_COLUMNS,
			}),
	};

export type ExportBnsNamespaceEventsRangeOptions = ExportDatasetRangeOptions;
export type ExportBnsNamespaceEventsRangeResult = ExportDatasetRangeResult;

export function exportBnsNamespaceEventsRange(
	options: ExportBnsNamespaceEventsRangeOptions,
): Promise<ExportBnsNamespaceEventsRangeResult> {
	return exportDatasetRange(bnsNamespaceEventsExporterSpec, options);
}
