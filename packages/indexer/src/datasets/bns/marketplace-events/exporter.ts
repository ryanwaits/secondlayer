import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { buildSchemaDocument } from "../../_shared/parquet.ts";
import { writeBnsMarketplaceEventsParquet } from "./file.ts";
import {
	type BnsMarketplaceEventParquetRow,
	readCanonicalBnsMarketplaceEventRows,
} from "./query.ts";
import {
	BNS_MARKETPLACE_EVENTS_DATASET,
	BNS_MARKETPLACE_EVENTS_SCHEMA_COLUMNS,
	BNS_MARKETPLACE_EVENTS_SCHEMA_VERSION,
	BNS_MARKETPLACE_EVENTS_VERSION,
} from "./schema.ts";

export const bnsMarketplaceEventsExporterSpec: DatasetExporterSpec<BnsMarketplaceEventParquetRow> =
	{
		dataset: BNS_MARKETPLACE_EVENTS_DATASET,
		version: BNS_MARKETPLACE_EVENTS_VERSION,
		schemaVersion: BNS_MARKETPLACE_EVENTS_SCHEMA_VERSION,
		readRows: readCanonicalBnsMarketplaceEventRows,
		writeParquet: writeBnsMarketplaceEventsParquet,
		buildSchemaDocument: (network) =>
			buildSchemaDocument({
				dataset: BNS_MARKETPLACE_EVENTS_DATASET,
				version: BNS_MARKETPLACE_EVENTS_VERSION,
				schemaVersion: BNS_MARKETPLACE_EVENTS_SCHEMA_VERSION,
				network,
				columns: BNS_MARKETPLACE_EVENTS_SCHEMA_COLUMNS,
			}),
	};

export type ExportBnsMarketplaceEventsRangeOptions = ExportDatasetRangeOptions;
export type ExportBnsMarketplaceEventsRangeResult = ExportDatasetRangeResult;

export function exportBnsMarketplaceEventsRange(
	options: ExportBnsMarketplaceEventsRangeOptions,
): Promise<ExportBnsMarketplaceEventsRangeResult> {
	return exportDatasetRange(bnsMarketplaceEventsExporterSpec, options);
}
