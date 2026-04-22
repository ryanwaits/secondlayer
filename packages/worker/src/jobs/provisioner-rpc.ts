/**
 * Thin HTTP client for the provisioner, used by worker cron jobs.
 * Mirrors the API-side client at `packages/api/src/lib/provisioner-client.ts`
 * but lives in worker to avoid a cross-service package import.
 */

interface Config {
	url: string;
	secret: string;
}

function getConfig(): Config {
	const url = process.env.PROVISIONER_URL;
	const secret = process.env.PROVISIONER_SECRET;
	if (!url || !secret) {
		throw new Error("PROVISIONER_URL and PROVISIONER_SECRET required");
	}
	return { url: url.replace(/\/$/, ""), secret };
}

export interface TenantStatusResponse {
	slug: string;
	plan: string;
	containers: Array<{
		name: string;
		id: string;
		state: "running" | "exited" | "restarting" | "paused" | "unknown";
	}>;
	storageUsedMb?: number;
	storageLimitMb: number;
}

async function request<T>(
	path: string,
	method: "GET" | "POST" | "DELETE" = "GET",
): Promise<T | null> {
	const cfg = getConfig();
	const res = await fetch(`${cfg.url}${path}`, {
		method,
		headers: { "x-provisioner-secret": cfg.secret },
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`Provisioner ${method} ${path} → ${res.status}: ${body.slice(0, 200)}`,
		);
	}
	if (res.status === 204) return null;
	return (await res.json()) as T;
}

export async function getTenantStatus(
	slug: string,
	plan: string,
	storageLimitMb: number,
): Promise<TenantStatusResponse> {
	const qs = new URLSearchParams({
		plan,
		storageLimitMb: String(storageLimitMb),
	});
	const res = await request<TenantStatusResponse>(
		`/tenants/${slug}?${qs.toString()}`,
	);
	if (!res) throw new Error(`Provisioner returned no body for ${slug} status`);
	return res;
}

export async function getTenantStorage(
	slug: string,
	targetDatabaseUrl: string,
): Promise<{ slug: string; sizeMb: number }> {
	const res = await request<{ slug: string; sizeMb: number }>(
		`/tenants/${slug}/storage?url=${encodeURIComponent(targetDatabaseUrl)}`,
	);
	if (!res) throw new Error(`Provisioner returned no body for ${slug} storage`);
	return res;
}

export async function suspendTenant(slug: string): Promise<void> {
	await request(`/tenants/${slug}/suspend`, "POST");
}

export async function teardownTenant(
	slug: string,
	deleteVolume = false,
): Promise<void> {
	await request(
		`/tenants/${slug}?deleteVolume=${deleteVolume ? "true" : "false"}`,
		"DELETE",
	);
}
