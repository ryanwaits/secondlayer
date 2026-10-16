import { isIP } from "node:net";
import tls from "node:tls";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";
import { allowPrivateEgress, checkEgressAllowed } from "./emitter.ts";

/**
 * Receiver TLS certificate expiry. Bun's `fetch` does not expose the peer
 * certificate, so the emitter probes each https origin out of band with
 * `node:tls` (works under Bun) and stores the result on `webhooks`.
 */

const PROBE_TIMEOUT_MS = 5_000;
const RECHECK_AFTER_HOURS = 6;
const BATCH_LIMIT = 50;

/**
 * Leaf certificate expiry of an https receiver, or null for non-https URLs,
 * refused egress, connection errors and timeouts. Never throws. Passes the
 * same egress guard as deliveries.
 */
export async function probeCertExpiry(
	url: string,
	opts?: { connect?: typeof tls.connect; timeoutMs?: number },
): Promise<Date | null> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;

	if (!allowPrivateEgress()) {
		let refusal: string | null;
		try {
			refusal = await checkEgressAllowed(url);
		} catch {
			return null;
		}
		if (refusal) return null;
	}

	const raw = parsed.hostname;
	const host =
		raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
	const connect = opts?.connect ?? tls.connect;
	const timeoutMs = opts?.timeoutMs ?? PROBE_TIMEOUT_MS;

	return new Promise<Date | null>((resolve) => {
		const open: { socket?: tls.TLSSocket } = {};
		let settled = false;
		const finish = (expires: Date | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				open.socket?.destroy();
			} catch {
				// already closed
			}
			resolve(expires);
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		let probe: tls.TLSSocket;
		try {
			probe = connect({
				host,
				port: Number(parsed.port) || 443,
				...(isIP(host) ? {} : { servername: host }),
				// Only the leaf cert is read and no data is sent, so an expired or
				// self-signed cert must still report its expiry.
				rejectUnauthorized: false,
			});
		} catch {
			finish(null);
			return;
		}
		open.socket = probe;
		probe.once("secureConnect", () => {
			try {
				const expires = new Date(probe.getPeerCertificate().valid_to);
				finish(Number.isNaN(expires.getTime()) ? null : expires);
			} catch {
				finish(null);
			}
		});
		probe.once("error", () => finish(null));
	});
}

/**
 * Probe the https receivers whose expiry is unknown or older than six hours.
 * One probe per distinct origin; every selected webhook on that origin gets
 * the result (which may be null) and a fresh `receiver_cert_checked_at`.
 */
export async function refreshReceiverCerts(
	db: Kysely<Database>,
	opts?: { probe?: (url: string) => Promise<Date | null> },
): Promise<void> {
	const probe = opts?.probe ?? probeCertExpiry;
	const due = await db
		.selectFrom("webhooks")
		.select(["id", "url"])
		.where("status", "=", "active")
		.where("url", "like", "https:%")
		.where((eb) =>
			eb.or([
				eb("receiver_cert_checked_at", "is", null),
				eb(
					"receiver_cert_checked_at",
					"<",
					sql<Date>`now() - make_interval(hours => ${RECHECK_AFTER_HOURS})`,
				),
			]),
		)
		.orderBy(sql`receiver_cert_checked_at asc nulls first`)
		.limit(BATCH_LIMIT)
		.execute();

	const idsByOrigin = new Map<string, { url: string; ids: string[] }>();
	for (const { id, url } of due) {
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			continue;
		}
		const entry = idsByOrigin.get(origin) ?? { url, ids: [] };
		entry.ids.push(id);
		idsByOrigin.set(origin, entry);
	}

	for (const [origin, { url, ids }] of idsByOrigin) {
		const expires = await probe(url);
		await db
			.updateTable("webhooks")
			.set({
				receiver_cert_expires_at: expires,
				receiver_cert_checked_at: new Date(),
			})
			.where("id", "in", ids)
			.execute();
		logger.debug("[emitter] receiver cert probed", {
			origin,
			expiresAt: expires?.toISOString() ?? null,
		});
	}
}
