import { writeParquetFromColumns } from "../../_shared/parquet.ts";
import type { BnsNameEventParquetRow } from "./query.ts";
import { BNS_NAME_EVENTS_SCHEMA_COLUMNS } from "./schema.ts";

export async function writeBnsNameEventsParquet(params: {
	outputPath: string;
	rows: readonly BnsNameEventParquetRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await writeParquetFromColumns({
		outputPath: params.outputPath,
		rows: params.rows,
		columns: BNS_NAME_EVENTS_SCHEMA_COLUMNS,
		metadata: params.metadata,
	});
}
