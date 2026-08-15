/**
 * Mirror the archive's mutable pointers into the locally-served public tree.
 *
 * The immutable objects — partitions, digests, snapshot manifests — are written
 * to the staging directory by the exporter, and that same directory is what the
 * public archive host serves as a static tree. The two MUTABLE pointers are the
 * exception: `latest.json` and `status.json` were only ever PUT to R2, so the
 * served tree had no `status.json` at all (a documented endpoint that 404'd
 * from the day it shipped) and a `latest.json` that was current only because an
 * operator had copied it by hand. Found 2026-08-15 while tracing a staleness
 * page: the object the page told a reader to consult was unreachable.
 *
 * Opt-in through `ARCHIVE_PUBLIC_DIR`. A publisher that serves the archive
 * straight from object storage has no local tree to keep consistent, so unset
 * means "do nothing" rather than "misconfigured".
 */
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The locally-served public archive tree, or null when nothing is served. */
export function getPublicArchiveDir(): string | null {
	const dir = process.env.ARCHIVE_PUBLIC_DIR?.trim();
	return dir ? dir : null;
}

/**
 * Write a pointer into the public tree, atomically.
 *
 * The file is live — a reader can request it mid-write — so it lands via
 * temp-then-rename. `rename` within a directory is atomic, so a consumer sees
 * either the old pointer or the new one and never a truncated JSON body.
 *
 * Returns the path written, or null when no public tree is configured. Throws
 * on a real write failure: a pointer that reached R2 but not the tree the world
 * reads is exactly the split-brain this module exists to close.
 */
export async function mirrorToPublicArchive(params: {
	name: string;
	value: unknown;
}): Promise<string | null> {
	const dir = getPublicArchiveDir();
	if (!dir) return null;

	const target = join(dir, params.name);
	const temp = join(dir, `.${params.name}.tmp`);
	await writeFile(temp, `${JSON.stringify(params.value, null, 2)}\n`, "utf8");
	await rename(temp, target);
	return target;
}
