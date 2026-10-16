import { createHash } from "node:crypto";
import { logger } from "@secondlayer/shared";
import type { InsertApiRequestLogRow } from "@secondlayer/shared/db";
import type { MiddlewareHandler } from "hono";
import { getRequestId } from "./request-id.ts";

const MAX_PATH_CHARS = 300;

const DIGITS = /^\d+$/;
const HEX_PREFIXED = /^0x[0-9a-fA-F]+$/;
const LONG_HEX = /^[0-9a-fA-F]{20,}$/;
const PRINCIPAL = /^S[PTMN][0-9A-Z]{20,}(\.[A-Za-z][A-Za-z0-9-]*)?$/;

/** Replaces ids, hashes and principals in a path with `:param`. */
export function pathTemplate(path: string): string {
	return path
		.split("/")
		.map((segment) =>
			DIGITS.test(segment) ||
			HEX_PREFIXED.test(segment) ||
			LONG_HEX.test(segment) ||
			PRINCIPAL.test(segment)
				? ":param"
				: segment,
		)
		.join("/");
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Hashes of the query, never its values. `paramsHash` ignores the cursor so
 * pages of one walk share it; `cursorHash` identifies the page position.
 */
export function queryFingerprint(url: URL): {
	paramsHash: string | null;
	cursorHash: string | null;
	pageSize: number | null;
} {
	const rest = new URLSearchParams(url.searchParams);
	rest.delete("cursor");
	rest.sort();
	const paramsHash = rest.size > 0 ? shortHash(rest.toString()) : null;

	const cursor = url.searchParams.get("cursor");
	const cursorHash = cursor ? shortHash(cursor) : null;

	const limit = url.searchParams.get("limit");
	const parsed = limit && /^\d+$/.test(limit) ? Number.parseInt(limit, 10) : 0;
	const pageSize = parsed > 0 ? parsed : null;

	return { paramsHash, cursorHash, pageSize };
}

// Throttle recorder failures so a DB outage doesn't log once per request.
let lastRecordFailLogMs = 0;
function warnRecordFailure(err: unknown): void {
	const now = Date.now();
	if (now - lastRecordFailLogMs < 60_000) return;
	lastRecordFailLogMs = now;
	logger.warn("Request log write failed", {
		error: err instanceof Error ? err.message : String(err),
	});
}

/**
 * Records account-attributed Index and Streams reads for usage insights.
 * Mount on those surfaces only, hosted only. Reads the tenant and
 * `rowsServed` that the route stack set, and hands the row to `record`
 * without awaiting it: a write failure never delays or alters the response.
 */
export function requestLog(opts: {
	record: (row: InsertApiRequestLogRow) => Promise<void>;
}): MiddlewareHandler {
	return async (c, next) => {
		const started = performance.now();
		await next();

		const tenant = (c.get("indexTenant") ?? c.get("streamsTenant")) as
			| { account_id?: string; api_key_id?: string; tier?: string }
			| undefined;
		if (!tenant?.account_id || tenant.tier === "internal") return;

		const { paramsHash, cursorHash, pageSize } = queryFingerprint(
			new URL(c.req.url),
		);
		const row: InsertApiRequestLogRow = {
			request_id: getRequestId(c) ?? null,
			account_id: tenant.account_id,
			api_key_id: tenant.api_key_id ?? null,
			method: c.req.method,
			path: c.req.path.slice(0, MAX_PATH_CHARS),
			path_template: pathTemplate(c.req.path),
			params_hash: paramsHash,
			cursor_hash: cursorHash,
			page_size: pageSize,
			rows: (c.get("rowsServed") as number | undefined) ?? null,
			status: c.res.status,
			duration_ms: Math.round(performance.now() - started),
		};

		// Fire-and-forget: never delays or alters the response.
		void (async () => opts.record(row))().catch(warnRecordFailure);
	};
}
