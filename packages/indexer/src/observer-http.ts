import { timingSafeEqual } from "node:crypto";
import type {
	ListObserverMessagesOpts,
	ObserverTip,
	SbaObserverMessage,
} from "./observer-export.ts";
import type { ObserverPath } from "./observer-journal.ts";

/** Internal-only route. Not a public /v1 envelope. */
export const OBSERVER_HTTP_EXPORT_PATH = "/internal/observer-events";
export const OBSERVER_HTTP_TIP_PATH = `${OBSERVER_HTTP_EXPORT_PATH}/tip`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type HandleObserverEventsDeps = {
	list: (opts: ListObserverMessagesOpts) => Promise<SbaObserverMessage[]>;
	network: string;
	/** If non-null, require Authorization: Bearer with exact match. */
	token: string | null;
};

export type HandleObserverTipDeps = {
	tip: (opts: { network: string }) => Promise<ObserverTip>;
	network: string;
	/** If non-null, require Authorization: Bearer with exact match. */
	token: string | null;
};

export type ObserverEventsNext = {
	after_height: number;
	after_index_block_hash: string;
};

export type ObserverEventsResponse = {
	events: SbaObserverMessage[];
	next: ObserverEventsNext | null;
};

function isLoopbackBindHost(bindHost: string): boolean {
	return LOOPBACK_HOSTS.has(bindHost.trim().toLowerCase());
}

/** Timing-safe Bearer compare. Length mismatch still runs a dummy compare. */
function bearerMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) {
		timingSafeEqual(a, Buffer.alloc(a.length));
		return false;
	}
	return timingSafeEqual(a, b);
}

/**
 * Default off. Loopback bind may register without a token.
 * Public bind (incl. 0.0.0.0 / empty / unset) requires a non-empty token.
 */
export function shouldRegisterObserverHttpExport(opts: {
	exportFlag: string | undefined;
	token: string | undefined;
	bindHost: string;
}): boolean {
	if (opts.exportFlag !== "1") return false;
	if (isLoopbackBindHost(opts.bindHost)) return true;
	return typeof opts.token === "string" && opts.token.length > 0;
}

/**
 * Read INDEXER_HOST then HOST. Neither set → `"0.0.0.0"` (Bun.serve
 * only sets port today, so bind is treated as public).
 */
export function resolveObserverHttpBindHost(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
	const raw = (env.INDEXER_HOST ?? env.HOST)?.trim();
	if (raw && raw.length > 0) return raw;
	return "0.0.0.0";
}

function parseBearer(req: Request): string {
	const header = req.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) return "";
	return header.slice("Bearer ".length);
}

function unauthorizedIfNeeded(
	req: Request,
	token: string | null,
): Response | null {
	if (token === null) return null;
	const provided = parseBearer(req);
	if (!bearerMatches(provided, token)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	return null;
}

function nextCursor(
	events: readonly SbaObserverMessage[],
): ObserverEventsNext | null {
	if (events.length === 0) return null;
	const last = events[events.length - 1] as SbaObserverMessage;
	if (last.block_height == null || last.index_block_hash == null) return null;
	return {
		after_height: last.block_height,
		after_index_block_hash: last.index_block_hash,
	};
}

export async function handleObserverTip(
	req: Request,
	deps: HandleObserverTipDeps,
): Promise<Response> {
	const denied = unauthorizedIfNeeded(req, deps.token);
	if (denied) return denied;

	const tip = await deps.tip({ network: deps.network });
	return Response.json(tip);
}

export async function handleObserverEvents(
	req: Request,
	deps: HandleObserverEventsDeps,
): Promise<Response> {
	const denied = unauthorizedIfNeeded(req, deps.token);
	if (denied) return denied;

	const url = new URL(req.url);

	let afterHeight: number | undefined;
	if (url.searchParams.has("after_height")) {
		const raw = url.searchParams.get("after_height") ?? "";
		const n = Number(raw);
		if (!Number.isInteger(n)) {
			return Response.json({ error: "invalid after_height" }, { status: 400 });
		}
		afterHeight = n;
	}

	const afterIndexBlockHash =
		url.searchParams.get("after_index_block_hash") ?? undefined;

	let limit = 100;
	if (url.searchParams.has("limit")) {
		const raw = url.searchParams.get("limit") ?? "";
		const n = Number(raw);
		if (!Number.isInteger(n)) {
			return Response.json({ error: "invalid limit" }, { status: 400 });
		}
		limit = Math.min(1000, Math.max(1, n));
	}

	const pathParam = url.searchParams.get("path");
	let paths: ObserverPath[] | undefined;
	if (pathParam !== null) {
		if (pathParam !== "/new_block" && pathParam !== "/new_burn_block") {
			return Response.json({ error: "invalid path" }, { status: 400 });
		}
		paths = [pathParam];
	}

	const events = await deps.list({
		network: deps.network,
		afterHeight,
		afterIndexBlockHash:
			afterIndexBlockHash && afterIndexBlockHash.length > 0
				? afterIndexBlockHash
				: undefined,
		limit,
		paths,
	});

	const body: ObserverEventsResponse = {
		events,
		next: nextCursor(events),
	};
	return Response.json(body);
}
