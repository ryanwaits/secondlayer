import { writeParquetFromColumns } from "../../_shared/parquet.ts";
import type { BnsNamespaceEventParquetRow } from "./query.ts";
import { BNS_NAMESPACE_EVENTS_SCHEMA_COLUMNS } from "./schema.ts";

export async function writeBnsNamespaceEventsParquet(params: {
	outputPath: string;
	rows: readonly BnsNamespaceEventParquetRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await writeParquetFromColumns({
		outputPath: params.outputPath,
		rows: params.rows,
		columns: BNS_NAMESPACE_EVENTS_SCHEMA_COLUMNS,
		metadata: params.metadata,
	});
}
