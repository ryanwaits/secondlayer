import { ed25519 } from "@secondlayer/shared";
import { buildQuery } from "../base.ts";
import {
	StreamsServerError,
	StreamsSignatureError,
	mapStreamsError,
} from "./errors.ts";
import type {
	FetchLike,
	StreamsEvent,
	StreamsEventsSubscribeParams,
	StreamsSubscription,
} from "./types.ts";

type VerificationKey = {
	keyId: string;
	publicKey: ReturnType<typeof ed25519.loadEd25519PublicKey>;
};

/** Backoff ceiling: a subscriber that keeps failing asks once per half
 *  minute, which a restarting instance can absorb from every worker at once. */
export const SUBSCRIBE_MAX_RECONNECT_DELAY_MS = 30_000;
/** Three server heartbeats (20 s each) with no frame means the socket is
 *  half-open, not idle. */
export const SUBSCRIBE_DEFAULT_STALE_AFTER_MS = 60_000;

/**
 * Pause before reconnect attempt `attempt` (0 = first retry): `base * 2^attempt`
 * capped at 30 s, scaled by a jitter in [0.5, 1] so a fleet that dropped
 * together does not reconnect together. Never shorter than a `Retry-After`
 * the server sent, since that is the one number it is sure about.
 */
export function reconnectDelay(
	attempt: number,
	baseMs: number,
	retryAfterSeconds?: number,
	random: () => number = Math.random,
): number {
	const capped = Math.min(
		baseMs * 2 ** Math.max(0, attempt),
		SUBSCRIBE_MAX_RECONNECT_DELAY_MS,
	);
	const jittered = capped * (0.5 + random() * 0.5);
	const floor = (retryAfterSeconds ?? 0) * 1000;
	return Math.max(jittered, floor);
}

/** An error the loop stops on: a retry cannot change the answer. */
function isTerminal(err: unknown): boolean {
	if (err instanceof StreamsSignatureError) return true;
	return (err as { retryable?: boolean } | null)?.retryable === false;
}

/**
 * Subscribe to the Streams SSE push surface (`GET /v1/streams/events/stream`).
 *
 * A fetch-based reader (not `EventSource`) so it can send `Authorization` when
 * a key is present, which `EventSource` cannot. Works in browsers and Node 18+.
 * Reconnects from the last handled cursor after a dropped connection, a clean
 * server close, or a stale socket, with exponential backoff; stops on an error
 * a retry cannot fix and rejects the handle's `done`.
 */
export function subscribeStreamsEvents(opts: {
	baseUrl: string;
	/** Request headers for every connection (bearer token, `x-sl-origin`). */
	headers?: Record<string, string>;
	fetchImpl: FetchLike;
	/**
	 * `off` skips verification; `lenient` (default) verifies a frame when it
	 * carries a `sig` and delivers it unverified when it doesn't (unsigned
	 * self-host); `strict` requires every frame to be signed. An invalid `sig`
	 * always throws regardless of mode.
	 */
	verify: "off" | "lenient" | "strict";
	/** Resolve the key a frame names by `key_id` (a fetched key refreshes once
	 *  on an unknown id; a pinned key fails closed), or the cached key when
	 *  the frame carries none. */
	loadKey: (keyId?: string | null) => Promise<VerificationKey>;
	/** First reconnect pause; see {@link StreamsEventsSubscribeParams.reconnectDelayMs}. */
	reconnectDelayMs?: number;
	/** Idle limit before the socket is treated as dead; see
	 *  {@link StreamsEventsSubscribeParams.staleAfterMs}. */
	staleAfterMs?: number;
	/** Jitter source, injectable for tests. */
	random?: () => number;
	params: StreamsEventsSubscribeParams;
}): StreamsSubscription {
	const { params } = opts;
	const controller = new AbortController();
	const external = params.signal;
	if (external) {
		if (external.aborted) controller.abort();
		else
			external.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
	}
	let cursor = params.fromCursor ?? null;
	const baseDelayMs = opts.reconnectDelayMs ?? params.reconnectDelayMs ?? 1000;
	const staleAfterMs =
		opts.staleAfterMs ??
		params.staleAfterMs ??
		SUBSCRIBE_DEFAULT_STALE_AFTER_MS;
	// Consecutive failures since the last frame; drives the backoff exponent.
	let attempt = 0;

	const run = async (): Promise<void> => {
		while (!controller.signal.aborted) {
			try {
				const url = `${opts.baseUrl}/v1/streams/events/stream${buildQuery({
					from_cursor: cursor ?? undefined,
					types: params.types,
					not_types: params.notTypes,
					contract_id: params.contractId,
					sender: params.sender,
					recipient: params.recipient,
					asset_identifier: params.assetIdentifier,
					// JSON in a query param, so SSE keeps plain GET semantics:
					// no POST-and-stream variant of this route.
					filters: params.filters ? JSON.stringify(params.filters) : undefined,
				})}`;
				await readSse({
					url,
					headers: opts.headers ?? {},
					signal: controller.signal,
					fetchImpl: opts.fetchImpl,
					staleAfterMs,
					mapError: mapStreamsError,
					onFrame: async (frame) => {
						// Any frame, ping included, proves the socket is live.
						attempt = 0;
						if (frame.event === "ping" || !frame.data) return;
						let parsed: { event?: StreamsEvent; sig?: string; key_id?: string };
						try {
							parsed = JSON.parse(frame.data);
						} catch {
							return; // ignore non-JSON frames
						}
						if (!parsed.event) return;
						if (opts.verify !== "off") {
							if (!parsed.sig) {
								// Strict requires a signed frame; lenient (default) delivers an
								// unsigned frame (e.g. self-host with no signing key).
								if (opts.verify === "strict") {
									throw new StreamsSignatureError(
										"Streams SSE frame signature is missing.",
									);
								}
							} else {
								// The frame names its key, so a rotation mid-stream is a
								// one-time refresh instead of a reconnect loop that fails
								// every frame forever.
								const key = await opts.loadKey(parsed.key_id);
								// A signature is present, so verify it in either mode; an
								// invalid signature always fails closed.
								if (
									!ed25519.verifyEd25519(
										JSON.stringify(parsed.event),
										parsed.sig,
										key.publicKey,
									)
								) {
									throw new StreamsSignatureError(
										"Streams SSE frame signature is invalid.",
									);
								}
							}
						}
						// The cursor moves only once the handler has taken the event.
						// A throw here reconnects from the previous cursor, so this
						// event is delivered again rather than skipped.
						await params.onEvent(parsed.event);
						cursor = (parsed.event as { cursor?: string }).cursor ?? cursor;
					},
				});
				// Clean end (server closed the stream): reconnect from `cursor`
				// after the same pause as an error, so a proxy that answers 200 and
				// closes at once cannot spin a hot loop.
				await sleep(
					reconnectDelay(attempt, baseDelayMs, undefined, opts.random),
					controller.signal,
				);
				attempt += 1;
			} catch (err) {
				if (controller.signal.aborted) return;
				params.onError?.(err);
				if (isTerminal(err)) throw err;
				const retryAfterSeconds = (err as { retryAfterSeconds?: number })
					.retryAfterSeconds;
				await sleep(
					reconnectDelay(attempt, baseDelayMs, retryAfterSeconds, opts.random),
					controller.signal,
				);
				attempt += 1;
			}
		}
	};
	const done = run();
	// The caller may never look at `done`; a terminal error already reached
	// `onError`, so an unobserved rejection must not crash the process.
	done.catch(() => {});
	const unsubscribe = () => controller.abort();
	return Object.assign(unsubscribe, { done });
}

/** One parsed `text/event-stream` frame. */
export type SseFrame = { event?: string; data?: string };

/**
 * Open one SSE connection and hand every frame to `onFrame` until the server
 * closes the stream or `signal` aborts. Fetch-based rather than `EventSource`
 * so the request can carry `Authorization`. A non-OK response throws through
 * `mapError` (default: a retryable `StreamsServerError`); a thrown `onFrame`
 * propagates and cancels the body. With `staleAfterMs`, a read that sees no
 * frame for that long cancels the body and throws a retryable
 * `StreamsServerError` (`STREAM_STALE`). Reconnecting is the caller's job, so
 * each surface keeps its own cursor rule.
 */
export async function readSse(opts: {
	url: string;
	headers?: Record<string, string>;
	signal: AbortSignal;
	fetchImpl: FetchLike;
	onFrame: (frame: SseFrame) => void | Promise<void>;
	staleAfterMs?: number;
	mapError?: (res: Response) => Promise<never>;
}): Promise<void> {
	const res = await opts.fetchImpl(opts.url, {
		headers: { ...(opts.headers ?? {}), Accept: "text/event-stream" },
		signal: opts.signal,
	});
	if (!res.ok) {
		if (opts.mapError) await opts.mapError(res);
		throw new StreamsServerError(
			`Streams SSE returned ${res.status}.`,
			res.status,
		);
	}
	if (!res.body) {
		throw new StreamsServerError("Streams SSE response has no body.", 0);
	}
	for await (const frame of parseSseFrames(
		res.body,
		opts.signal,
		opts.staleAfterMs,
	)) {
		await opts.onFrame(frame);
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/** `reader.read()` raced against an idle timer; a timeout throws a retryable
 *  error so the caller's reconnect path takes over. */
async function readWithStaleTimer<R extends { read(): Promise<unknown> }>(
	reader: R,
	staleAfterMs: number | undefined,
): Promise<Awaited<ReturnType<R["read"]>>> {
	if (staleAfterMs === undefined || !Number.isFinite(staleAfterMs)) {
		return reader.read() as Promise<Awaited<ReturnType<R["read"]>>>;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stale = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new StreamsServerError(
						`Streams SSE went quiet for ${staleAfterMs} ms; reconnecting.`,
						0,
						undefined,
						"STREAM_STALE",
					),
				),
			staleAfterMs,
		);
	});
	try {
		return (await Promise.race([reader.read(), stale])) as Awaited<
			ReturnType<R["read"]>
		>;
	} finally {
		clearTimeout(timer);
	}
}

async function* parseSseFrames(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	staleAfterMs?: number,
): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!signal.aborted) {
			const { value, done } = await readWithStaleTimer(reader, staleAfterMs);
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let sep = buffer.indexOf("\n\n");
			while (sep !== -1) {
				yield parseFrame(buffer.slice(0, sep));
				buffer = buffer.slice(sep + 2);
				sep = buffer.indexOf("\n\n");
			}
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			// best-effort
		}
	}
}

function parseFrame(raw: string): SseFrame {
	let event: string | undefined;
	const data: string[] = [];
	for (const line of raw.split("\n")) {
		if (line.startsWith("data:")) {
			data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
		} else if (line.startsWith("event:")) {
			event = line.slice(line.startsWith("event: ") ? 7 : 6).trim();
		}
	}
	return { event, data: data.length > 0 ? data.join("\n") : undefined };
}
