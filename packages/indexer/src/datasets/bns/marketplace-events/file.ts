import { writeParquetFromColumns } from "../../_shared/parquet.ts";
import type { BnsMarketplaceEventParquetRow } from "./query.ts";
import { BNS_MARKETPLACE_EVENTS_SCHEMA_COLUMNS } from "./schema.ts";

export async function writeBnsMarketplaceEventsParquet(params: {
	outputPath: string;
	rows: readonly BnsMarketplaceEventParquetRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await writeParquetFromColumns({
		outputPath: params.outputPath,
		rows: params.rows,
		columns: BNS_MARKETPLACE_EVENTS_SCHEMA_COLUMNS,
		metadata: params.metadata,
	});
}
