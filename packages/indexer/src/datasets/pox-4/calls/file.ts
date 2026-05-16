import { writeParquetFromColumns } from "../../_shared/parquet.ts";
import type { Pox4CallParquetRow } from "./query.ts";
import { POX4_CALLS_SCHEMA_COLUMNS } from "./schema.ts";

export async function writePox4CallsParquet(params: {
	outputPath: string;
	rows: readonly Pox4CallParquetRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await writeParquetFromColumns({
		outputPath: params.outputPath,
		rows: params.rows,
		columns: POX4_CALLS_SCHEMA_COLUMNS,
		metadata: params.metadata,
	});
}
