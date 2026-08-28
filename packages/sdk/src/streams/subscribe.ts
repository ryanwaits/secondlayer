import { ed25519 } from "@secondlayer/shared";
import { buildQuery } from "../base.ts";
import { StreamsServerError, StreamsSignatureError } from "./errors.ts";
import type {
	FetchLike,
	StreamsEvent,
	StreamsEventsSubscribeParams,
} from "./types.ts";

type VerificationKey = {
	keyId: string;
	publicKey: ReturnType<typeof ed25519.loadEd25519PublicKey>;
};

/**
 * Subscribe to the Streams SSE push surface (`GET /v1/streams/events/stream`).
 *
 * A fetch-based reader (not `EventSource`) so it can send `Authorization` when
 * a key is present — `EventSource` can't set headers. Works in browsers and
 * Node 18+. Reconnects from the last delivered cursor on a dropped connection
 * until the caller's signal aborts.
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
	reconnectDelayMs?: number;
	params: StreamsEventsSubscribeParams;
}): () => void {
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
	const reconnectDelayMs = opts.reconnectDelayMs ?? 1000;

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
					// JSON in a query param, so SSE keeps plain GET semantics —
					// no POST-and-stream variant of this route.
					filters: params.filters ? JSON.stringify(params.filters) : undefined,
				})}`;
				await readSse({
					url,
					headers: opts.headers ?? {},
					signal: controller.signal,
					fetchImpl: opts.fetchImpl,
					onFrame: async (frame) => {
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
						cursor = (parsed.event as { cursor?: string }).cursor ?? cursor;
						await params.onEvent(parsed.event);
					},
				});
				// Clean end (server closed the stream): reconnect from `cursor`.
			} catch (err) {
				if (controller.signal.aborted) return;
				params.onError?.(err);
				await sleep(reconnectDelayMs, controller.signal);
			}
		}
	};
	void run();
	return () => controller.abort();
}

/** One parsed `text/event-stream` frame. */
export type SseFrame = { event?: string; data?: string };

/**
 * Open one SSE connection and hand every frame to `onFrame` until the server
 * closes the stream or `signal` aborts. Fetch-based rather than `EventSource`
 * so the request can carry `Authorization`. A non-OK response throws
 * `StreamsServerError`; a thrown `onFrame` propagates and cancels the body.
 * Reconnecting is the caller's job, so each surface keeps its own cursor rule.
 */
export async function readSse(opts: {
	url: string;
	headers?: Record<string, string>;
	signal: AbortSignal;
	fetchImpl: FetchLike;
	onFrame: (frame: SseFrame) => void | Promise<void>;
}): Promise<void> {
	const res = await opts.fetchImpl(opts.url, {
		headers: { ...(opts.headers ?? {}), Accept: "text/event-stream" },
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new StreamsServerError(
			`Streams SSE returned ${res.status}.`,
			res.status,
		);
	}
	if (!res.body) {
		throw new StreamsServerError("Streams SSE response has no body.", 0);
	}
	for await (const frame of parseSseFrames(res.body, opts.signal)) {
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

async function* parseSseFrames(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!signal.aborted) {
			const { value, done } = await reader.read();
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
