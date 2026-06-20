#!/usr/bin/env bun
/**
 * Staging health smoke check — runs on cron every 30 min via
 * .github/workflows/staging-health.yml.
 *
 * Probes the public status surface and a few derived invariants. Designed
 * to alert when the API is genuinely down, not on every momentary lag blip:
 *
 *   - Service `unavailable` → fail
 *   - Service `degraded` → notice (not failure)
 *   - Decoder `unavailable` → fail
 *   - Decoder lag ≤ DECODER_LAG_NOTICE_SECONDS (default 600s) → ignore
 *   - Decoder lag in (notice, alert] band → notice (not failure)
 *   - Decoder lag > DECODER_LAG_ALERT_SECONDS (default 1800s) → fail
 *
 * Replaces the python-in-bash `staging-health.sh` so we have one stack.
 */

const API_URL = (
	process.env.STAGING_API_URL ||
	process.env.SECOND_LAYER_API_URL ||
	"https://api.secondlayer.tools"
).replace(/\/$/, "");

const STATUS_KEY =
	process.env.STAGING_STATUS_API_KEY || process.env.SL_STATUS_API_KEY || "";
const DATABASE_URL =
	process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || "";

const TIMEOUT_MS =
	(Number(process.env.STAGING_HEALTH_TIMEOUT_SECONDS) || 15) * 1000;
const STREAMS_LAG_WARN_SECONDS =
	Number(process.env.STREAMS_LAG_WARN_SECONDS) || 600;
const DECODER_LAG_NOTICE_SECONDS =
	Number(process.env.DECODER_LAG_NOTICE_SECONDS) || 600;
const DECODER_LAG_ALERT_SECONDS =
	Number(process.env.DECODER_LAG_ALERT_SECONDS) || 1800;
const ZERO_TIMESTAMP_LOOKBACK_BLOCKS =
	Number(process.env.ZERO_TIMESTAMP_LOOKBACK_BLOCKS) || 5000;

const failures: string[] = [];
const notices: string[] = [];

async function fetchJson(
	label: string,
	path: string,
	token?: string,
): Promise<unknown | null> {
	const url = `${API_URL}${path}`;
	const headers: Record<string, string> = { accept: "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	try {
		const res = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) {
			failures.push(`${label}: HTTP ${res.status}`);
			return null;
		}
		return await res.json();
	} catch (err) {
		failures.push(
			`${label}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

function asRecord(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
}

async function checkPublicStatus(): Promise<void> {
	const body = await fetchJson("public status", "/public/status");
	if (!body) return;
	const root = asRecord(body);

	// API telemetry shape — every field still expected on the public surface.
	const api = asRecord(root.api);
	const latency = asRecord(api.latency);
	if (!("p50_ms" in latency)) failures.push("missing api.latency.p50_ms");
	if (!("p95_ms" in latency)) failures.push("missing api.latency.p95_ms");
	if (!("error_rate" in api)) failures.push("missing api.error_rate");

	const node = asRecord(root.node);
	if (!["ok", "degraded", "unavailable"].includes(String(node.status))) {
		failures.push("missing node.status");
	}

	// Services — fail only on `unavailable` (degraded is acceptable noise).
	const services = root.services;
	if (!Array.isArray(services) || services.length === 0) {
		failures.push("missing services");
	} else {
		const byName = new Map<string, Record<string, unknown>>(
			services.map((s) => [
				String((s as Record<string, unknown>).name),
				asRecord(s),
			]),
		);
		for (const required of ["api", "database", "indexer", "decoder"]) {
			const svc = byName.get(required);
			if (!svc) {
				failures.push(`missing ${required} service`);
				continue;
			}
			const status = String(svc.status);
			if (status === "unavailable") {
				failures.push(`${required} service unavailable`);
			} else if (status !== "ok") {
				notices.push(`${required} service status '${status}'`);
			}
		}
	}

	const streams = asRecord(root.streams);
	const tip = asRecord(streams.tip);
	const streamsLag = tip.lag_seconds;
	if (streamsLag === undefined || streamsLag === null) {
		failures.push("missing streams.tip.lag_seconds");
	} else if (Number(streamsLag) > STREAMS_LAG_WARN_SECONDS) {
		failures.push(`streams lag ${streamsLag}s > ${STREAMS_LAG_WARN_SECONDS}s`);
	}

	const dumps = streams.dumps;
	if (dumps === undefined || dumps === null) {
		failures.push("missing streams.dumps");
	} else {
		const dumpsRec = asRecord(dumps);
		for (const key of ["status", "latest_finalized_cursor", "lag_blocks"]) {
			if (!(key in dumpsRec)) failures.push(`missing streams.dumps.${key}`);
		}
		notices.push(
			`streams.dumps status='${String(dumpsRec.status)}' lag_blocks=${String(dumpsRec.lag_blocks)}`,
		);
	}

	// Decoders — banded lag thresholds. `unavailable` = real outage; large
	// lag = stuck for real; small lag = ignore (chain is just quiet).
	const index = asRecord(root.index);
	const decoders = Array.isArray(index.decoders) ? index.decoders : [];
	const byEventType = new Map<string, Record<string, unknown>>(
		decoders.map((d) => [
			String((d as Record<string, unknown>).eventType),
			asRecord(d),
		]),
	);
	for (const eventType of ["ft_transfer", "nft_transfer"]) {
		const decoder = byEventType.get(eventType);
		if (!decoder) {
			failures.push(`missing ${eventType} decoder`);
			continue;
		}
		const status = String(decoder.status);
		const lagRaw = decoder.lagSeconds;
		const lag = typeof lagRaw === "number" ? lagRaw : null;
		notices.push(
			`${eventType} decoder status='${status}' lagSeconds=${lag ?? "unknown"}`,
		);
		if (status === "unavailable") {
			failures.push(`${eventType} decoder unavailable`);
			continue;
		}
		if (lag === null) {
			notices.push(`${eventType} lag unknown`);
			continue;
		}
		if (lag > DECODER_LAG_ALERT_SECONDS) {
			failures.push(
				`${eventType} decoder stuck — lag ${lag}s > ${DECODER_LAG_ALERT_SECONDS}s`,
			);
		} else if (lag > DECODER_LAG_NOTICE_SECONDS) {
			notices.push(
				`${eventType} lag ${lag}s in notice band (${DECODER_LAG_NOTICE_SECONDS}s, ${DECODER_LAG_ALERT_SECONDS}s]`,
			);
		}
	}

	console.log("public status: checks complete");
}

async function checkAuthorizedStatus(): Promise<void> {
	if (!STATUS_KEY) {
		console.log("authorized status: skipped (STAGING_STATUS_API_KEY not set)");
		return;
	}
	const body = await fetchJson("authorized status", "/status", STATUS_KEY);
	if (!body) return;
	const root = asRecord(body);
	const dbStatus = String(asRecord(root.database).status);
	const indexStatus = String(asRecord(root.index).status);
	if (dbStatus !== "ok") failures.push(`database status '${dbStatus}'`);
	if (indexStatus === "unavailable") failures.push("index status unavailable");
	console.log("authorized status: database and index checked");
}

async function checkZeroTimestampBlocks(): Promise<void> {
	if (!DATABASE_URL) {
		console.log(
			"zero timestamp blocks: skipped (STAGING_DATABASE_URL not set)",
		);
		return;
	}
	try {
		// Bun.SQL replaces pg/postgres.js per project stack convention.
		const db = new Bun.SQL(DATABASE_URL);
		const rows = await db`
			WITH tip AS (
				SELECT COALESCE(MAX(height), 0) AS height
				FROM blocks
				WHERE canonical = true
			)
			SELECT COUNT(*)::bigint AS count
			FROM blocks, tip
			WHERE canonical = true
				AND timestamp = 0
				AND height >= GREATEST(0, tip.height - ${ZERO_TIMESTAMP_LOOKBACK_BLOCKS})
		`;
		const count = Number((rows[0] as { count: string | number })?.count ?? 0);
		if (count > 0) {
			failures.push(
				`zero timestamp blocks: ${count} recent canonical blocks have timestamp=0`,
			);
		} else {
			console.log("zero timestamp blocks: none in recent canonical window");
		}
		await db.close();
	} catch (err) {
		failures.push(
			`zero timestamp blocks: postgres query failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export {};

await checkPublicStatus();
await checkAuthorizedStatus();
await checkZeroTimestampBlocks();

for (const notice of notices) console.log(notice);
if (failures.length > 0) {
	for (const failure of failures) console.error(failure);
	console.error(`staging health failed: ${failures.length}`);
	process.exit(1);
}
console.log("staging health passed");
