import { ed25519 } from "@secondlayer/shared";
import { buildQuery } from "../base.ts";
import { StreamsServerError, StreamsSignatureError } from "./errors.ts";
import type {
	FetchLike,
	StreamsEvent,
	StreamsEventsSubscribeParams,
} from "./types.ts";

type VerificationKey = {
	publicKey: ReturnType<typeof ed25519.loadEd25519PublicKey>;
};

/**
 * Subscribe to the Streams SSE push surface (`GET /v1/streams/events/stream`).
 *
 * A fetch-based reader (not `EventSource`) so it can send the mandatory
 * `Authorization` header — Streams is key-mandatory and `EventSource` can't set
 * headers. Works in browsers and Node 18+. Reconnects from the last delivered
 * cursor on a dropped connection until the caller's signal aborts.
 */
export function subscribeStreamsEvents(opts: {
	baseUrl: string;
	apiKey: string;
	fetchImpl: FetchLike;
	/**
	 * `off` skips verification; `lenient` (default) verifies a frame when it
	 * carries a `sig` and delivers it unverified when it doesn't (unsigned
	 * self-host); `strict` requires every frame to be signed. An invalid `sig`
	 * always throws regardless of mode.
	 */
	verify: "off" | "lenient" | "strict";
	loadKey: () => Promise<VerificationKey>;
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
				})}`;
				const res = await opts.fetchImpl(url, {
					headers: {
						Authorization: `Bearer ${opts.apiKey}`,
						Accept: "text/event-stream",
					},
					signal: controller.signal,
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
				for await (const frame of parseSseFrames(res.body, controller.signal)) {
					if (frame.event === "ping" || !frame.data) continue;
					let parsed: { event?: StreamsEvent; sig?: string };
					try {
						parsed = JSON.parse(frame.data);
					} catch {
						continue; // ignore non-JSON frames
					}
					if (!parsed.event) continue;
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
							const key = await opts.loadKey();
							// A signature is present, so verify it in either mode — an
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
				}
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
): AsyncGenerator<{ event?: string; data?: string }> {
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

function parseFrame(raw: string): { event?: string; data?: string } {
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
