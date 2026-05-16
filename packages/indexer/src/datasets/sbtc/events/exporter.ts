import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { writeSbtcEventsParquet } from "./file.ts";
import { type SbtcEventRow, readCanonicalSbtcEventRows } from "./query.ts";
import {
	SBTC_EVENTS_DATASET,
	SBTC_EVENTS_SCHEMA_VERSION,
	SBTC_EVENTS_VERSION,
	createSbtcEventsSchemaDocument,
} from "./schema.ts";

export const sbtcEventsExporterSpec: DatasetExporterSpec<SbtcEventRow> = {
	dataset: SBTC_EVENTS_DATASET,
	version: SBTC_EVENTS_VERSION,
	schemaVersion: SBTC_EVENTS_SCHEMA_VERSION,
	readRows: readCanonicalSbtcEventRows,
	writeParquet: writeSbtcEventsParquet,
	buildSchemaDocument: createSbtcEventsSchemaDocument,
};

export type ExportSbtcEventsRangeOptions = ExportDatasetRangeOptions;
export type ExportSbtcEventsRangeResult = ExportDatasetRangeResult;

export function exportSbtcEventsRange(
	options: ExportSbtcEventsRangeOptions,
): Promise<ExportSbtcEventsRangeResult> {
	return exportDatasetRange(sbtcEventsExporterSpec, options);
}
