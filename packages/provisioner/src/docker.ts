/**
 * Thin typed Docker Engine API client — speaks HTTP over a unix socket.
 *
 * Bun supports unix-socket HTTP via `fetch(url, { unix: "/path" })`. The URL
 * host is a placeholder; the `unix` option picks the transport. We use
 * `http://docker/...` as the base; only the path matters.
 *
 * Surface is intentionally narrow — only the calls the provisioner needs.
 * Full API spec: https://docs.docker.com/engine/api/v1.45/
 */

import { logger } from "@secondlayer/shared";
import { getConfig } from "./config.ts";

const API_BASE = "http://docker";

function socket(): string {
	return getConfig().dockerSocketPath;
}

interface DockerRequestOptions {
	method?: "GET" | "POST" | "DELETE" | "PUT";
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	/** Accept 404 as non-fatal (caller handles null return). */
	allow404?: boolean;
	/** Read response as NDJSON stream (image pull uses this). */
	stream?: boolean;
}

async function request<T>(
	path: string,
	opts: DockerRequestOptions = {},
): Promise<T | null> {
	const { method = "GET", query, body, allow404, stream } = opts;
	const qs = query
		? `?${Object.entries(query)
				.filter(([, v]) => v !== undefined)
				.map(
					([k, v]) =>
						`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
				)
				.join("&")}`
		: "";
	const url = `${API_BASE}${path}${qs}`;
	const init: RequestInit & { unix?: string } = {
		method,
		unix: socket(),
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	};
	const res = await fetch(url, init);

	if (res.status === 404 && allow404) return null;
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new DockerApiError(res.status, method, path, text);
	}
	if (res.status === 204) return null;

	if (stream) {
		// Drain NDJSON without parsing — caller just cares about completion.
		const reader = res.body?.getReader();
		if (!reader) return null;
		const decoder = new TextDecoder();
		let done = false;
		while (!done) {
			const chunk = await reader.read();
			done = chunk.done;
			if (chunk.value) {
				const text = decoder.decode(chunk.value);
				// Log progress lines from image pull for visibility.
				for (const line of text.split("\n")) {
					if (!line.trim()) continue;
					try {
						const entry = JSON.parse(line);
						if (entry.error)
							throw new Error(`Docker pull error: ${entry.error}`);
					} catch {
						// Non-JSON progress lines are ignored.
					}
				}
			}
		}
		return null;
	}

	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		return (await res.json()) as T;
	}
	return null;
}

export class DockerApiError extends Error {
	override readonly name = "DockerApiError";
	constructor(
		readonly status: number,
		readonly method: string,
		readonly path: string,
		readonly responseBody: string,
	) {
		super(
			`Docker API ${method} ${path} → ${status}: ${responseBody.slice(0, 200)}`,
		);
	}
}

// --- Images ---

export async function pullImage(image: string): Promise<void> {
	logger.info("Pulling image", { image });
	await request("/images/create", {
		method: "POST",
		query: { fromImage: image },
		stream: true,
	});
}

// --- Networks ---

interface NetworkInspectResponse {
	Id: string;
	Name: string;
	Driver: string;
}

export async function networkInspect(
	name: string,
): Promise<NetworkInspectResponse | null> {
	return request<NetworkInspectResponse>(`/networks/${name}`, {
		allow404: true,
	});
}

export async function networkEnsure(name: string): Promise<string> {
	const existing = await networkInspect(name);
	if (existing) return existing.Id;
	const created = await request<{ Id: string }>("/networks/create", {
		method: "POST",
		body: { Name: name, Driver: "bridge" },
	});
	if (!created) throw new Error(`Failed to create network ${name}`);
	return created.Id;
}

// --- Volumes ---

interface VolumeInspectResponse {
	Name: string;
	Mountpoint: string;
}

export async function volumeInspect(
	name: string,
): Promise<VolumeInspectResponse | null> {
	return request<VolumeInspectResponse>(`/volumes/${name}`, { allow404: true });
}

export async function volumeEnsure(name: string): Promise<string> {
	const existing = await volumeInspect(name);
	if (existing) return existing.Name;
	const created = await request<{ Name: string }>("/volumes/create", {
		method: "POST",
		body: { Name: name },
	});
	if (!created) throw new Error(`Failed to create volume ${name}`);
	return created.Name;
}

export async function volumeRemove(name: string): Promise<void> {
	await request(`/volumes/${name}`, { method: "DELETE", allow404: true });
}

// --- Containers ---

export interface ContainerSpec {
	name: string;
	image: string;
	env?: Record<string, string>;
	cmd?: string[];
	entrypoint?: string[];
	exposedPorts?: string[];
	mounts?: Array<{
		type: "volume" | "bind";
		source: string;
		target: string;
		readOnly?: boolean;
	}>;
	networks: string[];
	labels?: Record<string, string>;
	memoryMb: number;
	cpus: number;
	healthCheck?: {
		cmd: string[];
		interval: string; // e.g. "10s"
		timeout: string;
		retries: number;
		startPeriod?: string;
	};
	restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
}

interface ContainerCreateResponse {
	Id: string;
	Warnings: string[];
}

function nanosFromDuration(s: string): number {
	const match = s.match(/^(\d+)(ms|s|m|h)$/);
	if (!match) throw new Error(`Invalid duration: ${s}`);
	const n = Number.parseInt(match[1], 10);
	const unit = match[2];
	switch (unit) {
		case "ms":
			return n * 1_000_000;
		case "s":
			return n * 1_000_000_000;
		case "m":
			return n * 60 * 1_000_000_000;
		case "h":
			return n * 3600 * 1_000_000_000;
	}
	throw new Error(`Unreachable: ${unit}`);
}

function buildContainerBody(spec: ContainerSpec): unknown {
	const env = spec.env
		? Object.entries(spec.env).map(([k, v]) => `${k}=${v}`)
		: [];

	const exposedPorts: Record<string, Record<string, never>> = {};
	for (const p of spec.exposedPorts ?? []) {
		exposedPorts[p] = {};
	}

	const mounts = (spec.mounts ?? []).map((m) => ({
		Type: m.type,
		Source: m.source,
		Target: m.target,
		ReadOnly: m.readOnly ?? false,
	}));

	const healthcheck = spec.healthCheck
		? {
				Test: ["CMD", ...spec.healthCheck.cmd],
				Interval: nanosFromDuration(spec.healthCheck.interval),
				Timeout: nanosFromDuration(spec.healthCheck.timeout),
				Retries: spec.healthCheck.retries,
				StartPeriod: spec.healthCheck.startPeriod
					? nanosFromDuration(spec.healthCheck.startPeriod)
					: 0,
			}
		: undefined;

	return {
		Image: spec.image,
		Env: env,
		Cmd: spec.cmd,
		Entrypoint: spec.entrypoint,
		ExposedPorts: exposedPorts,
		Labels: spec.labels ?? {},
		Healthcheck: healthcheck,
		HostConfig: {
			Memory: spec.memoryMb * 1024 * 1024,
			NanoCpus: Math.round(spec.cpus * 1_000_000_000),
			Mounts: mounts,
			RestartPolicy: { Name: spec.restartPolicy ?? "unless-stopped" },
			NetworkMode: spec.networks[0],
		},
		NetworkingConfig: {
			EndpointsConfig: Object.fromEntries(spec.networks.map((n) => [n, {}])),
		},
	};
}

export async function containerCreate(spec: ContainerSpec): Promise<string> {
	const body = buildContainerBody(spec);
	const res = await request<ContainerCreateResponse>("/containers/create", {
		method: "POST",
		query: { name: spec.name },
		body,
	});
	if (!res) throw new Error(`Failed to create container ${spec.name}`);
	return res.Id;
}

export async function containerStart(id: string): Promise<void> {
	await request(`/containers/${id}/start`, { method: "POST", allow404: true });
}

export async function containerStop(
	id: string,
	timeoutSec = 30,
): Promise<void> {
	await request(`/containers/${id}/stop`, {
		method: "POST",
		query: { t: timeoutSec },
		allow404: true,
	});
}

export async function containerRemove(id: string): Promise<void> {
	await request(`/containers/${id}`, {
		method: "DELETE",
		query: { force: true, v: false },
		allow404: true,
	});
}

interface ContainerInspectResponse {
	Id: string;
	Name: string;
	State: {
		Status: string;
		Running: boolean;
		Health?: {
			Status: "starting" | "healthy" | "unhealthy";
		};
	};
	HostConfig: {
		Memory: number;
		NanoCpus: number;
	};
}

export async function containerInspect(
	nameOrId: string,
): Promise<ContainerInspectResponse | null> {
	return request<ContainerInspectResponse>(`/containers/${nameOrId}/json`, {
		allow404: true,
	});
}

/**
 * Poll container health until it's `healthy` or timeout. Throws on unhealthy
 * or timeout. Returns silently on success.
 */
export async function waitForHealthy(
	nameOrId: string,
	timeoutMs = 60_000,
): Promise<void> {
	const start = Date.now();
	const pollMs = 1000;
	while (Date.now() - start < timeoutMs) {
		const info = await containerInspect(nameOrId);
		if (!info) throw new Error(`Container ${nameOrId} not found`);
		const health = info.State.Health?.Status;
		if (health === "healthy") return;
		if (health === "unhealthy") {
			throw new Error(`Container ${nameOrId} became unhealthy`);
		}
		// No healthcheck configured — fall back to Running=true after a brief grace period.
		if (!info.State.Health && info.State.Running && Date.now() - start > 3000) {
			return;
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
	throw new Error(`Timed out waiting for ${nameOrId} to become healthy`);
}

// --- Exec (used to run migrations in the API image against the tenant PG) ---

interface ExecCreateResponse {
	Id: string;
}

interface ExecInspectResponse {
	Running: boolean;
	ExitCode: number | null;
}

export async function containerExec(
	nameOrId: string,
	cmd: string[],
	env?: Record<string, string>,
): Promise<{ exitCode: number }> {
	const create = await request<ExecCreateResponse>(
		`/containers/${nameOrId}/exec`,
		{
			method: "POST",
			body: {
				AttachStdout: true,
				AttachStderr: true,
				Cmd: cmd,
				Env: env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined,
			},
		},
	);
	if (!create) throw new Error(`Failed to create exec on ${nameOrId}`);

	await request(`/exec/${create.Id}/start`, {
		method: "POST",
		body: { Detach: false, Tty: false },
	});

	// Poll exec inspect for completion.
	const deadline = Date.now() + 10 * 60 * 1000; // 10 min
	while (Date.now() < deadline) {
		const info = await request<ExecInspectResponse>(`/exec/${create.Id}/json`);
		if (info && !info.Running) {
			return { exitCode: info.ExitCode ?? 0 };
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Exec on ${nameOrId} exceeded timeout`);
}

// --- Stats (one-shot for resource usage reporting) ---

interface ContainerStatsResponse {
	cpu_stats: {
		cpu_usage: { total_usage: number };
		system_cpu_usage: number;
		online_cpus: number;
	};
	precpu_stats: {
		cpu_usage: { total_usage: number };
		system_cpu_usage: number;
	};
	memory_stats: {
		usage?: number;
		limit?: number;
	};
}

export async function containerStats(nameOrId: string): Promise<{
	cpuUsage: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
} | null> {
	const res = await request<ContainerStatsResponse>(
		`/containers/${nameOrId}/stats`,
		{
			query: { stream: false, "one-shot": true },
			allow404: true,
		},
	);
	if (!res) return null;

	const cpuDelta =
		res.cpu_stats.cpu_usage.total_usage -
		res.precpu_stats.cpu_usage.total_usage;
	const systemDelta =
		res.cpu_stats.system_cpu_usage - res.precpu_stats.system_cpu_usage;
	const cpuUsage =
		systemDelta > 0 ? (cpuDelta / systemDelta) * res.cpu_stats.online_cpus : 0;

	return {
		cpuUsage,
		memoryUsageBytes: res.memory_stats.usage ?? 0,
		memoryLimitBytes: res.memory_stats.limit ?? 0,
	};
}
