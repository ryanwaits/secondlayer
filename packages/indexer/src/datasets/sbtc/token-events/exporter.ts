import type {
	DatasetExporterSpec,
	ExportDatasetRangeOptions,
	ExportDatasetRangeResult,
} from "../../_shared/exporter.ts";
import { exportDatasetRange } from "../../_shared/exporter.ts";
import { writeSbtcTokenEventsParquet } from "./file.ts";
import {
	type SbtcTokenEventRow,
	readCanonicalSbtcTokenEventRows,
} from "./query.ts";
import {
	SBTC_TOKEN_EVENTS_DATASET,
	SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
	SBTC_TOKEN_EVENTS_VERSION,
	createSbtcTokenEventsSchemaDocument,
} from "./schema.ts";

export const sbtcTokenEventsExporterSpec: DatasetExporterSpec<SbtcTokenEventRow> =
	{
		dataset: SBTC_TOKEN_EVENTS_DATASET,
		version: SBTC_TOKEN_EVENTS_VERSION,
		schemaVersion: SBTC_TOKEN_EVENTS_SCHEMA_VERSION,
		readRows: readCanonicalSbtcTokenEventRows,
		writeParquet: writeSbtcTokenEventsParquet,
		buildSchemaDocument: createSbtcTokenEventsSchemaDocument,
	};

export type ExportSbtcTokenEventsRangeOptions = ExportDatasetRangeOptions;
export type ExportSbtcTokenEventsRangeResult = ExportDatasetRangeResult;

export function exportSbtcTokenEventsRange(
	options: ExportSbtcTokenEventsRangeOptions,
): Promise<ExportSbtcTokenEventsRangeResult> {
	return exportDatasetRange(sbtcTokenEventsExporterSpec, options);
}
