import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import type { ArchiveRow } from "@secondlayer/shared/archive/copy-loader";

/**
 * Stream the rows of a fetched Parquet partition. parquetjs reads from a
 * path, so the bytes are staged in a temp file for the life of the iterator
 * and removed when it closes, whether it ran to the end or not.
 */
export async function* readPartitionRows(
	bytes: Buffer,
	label: string,
): AsyncGenerator<ArchiveRow> {
	const path = join(tmpdir(), `sl-archive-${label}-${process.pid}.parquet`);
	await writeFile(path, bytes);
	try {
		const reader = await ParquetReader.openFile(path);
		try {
			const cursor = reader.getCursor();
			for (
				let row = (await cursor.next()) as ArchiveRow | null;
				row;
				row = (await cursor.next()) as ArchiveRow | null
			) {
				yield row;
			}
		} finally {
			await reader.close();
		}
	} finally {
		await unlink(path).catch(() => {});
	}
}
