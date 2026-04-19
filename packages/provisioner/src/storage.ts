/**
 * Measure per-tenant Postgres storage usage.
 *
 * The control plane schedules this via `GET /tenants/:slug/storage`. Alert
 * + overage billing logic lives there — provisioner just reports raw numbers.
 */

import postgres from "postgres";
import { pgContainerName } from "./names.ts";

/**
 * Return the tenant DB's total size in MB. Connects to the tenant PG
 * container by hostname on the `sl-tenants` network.
 *
 * Requires a connection string — caller (control plane) passes the URL it
 * stored at provision time.
 */
export async function measureStorageMb(
	targetDatabaseUrl: string,
): Promise<number> {
	const client = postgres(targetDatabaseUrl, { max: 1, onnotice: () => {} });
	try {
		const [row] = await client<{ size_mb: number }[]>`
			SELECT pg_database_size(current_database())::bigint / (1024 * 1024) AS size_mb
		`;
		return Number(row?.size_mb ?? 0);
	} finally {
		await client.end();
	}
}

/**
 * Connection string from within a container on the `sl-tenants` network.
 * Used by the control plane when it needs to probe a tenant DB without
 * knowing the stored URL.
 */
export function tenantDbUrlBySlug(slug: string, password: string): string {
	return `postgres://secondlayer:${encodeURIComponent(password)}@${pgContainerName(slug)}:5432/secondlayer`;
}
