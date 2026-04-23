import { verify } from "@secondlayer/shared/crypto/standard-webhooks";
import { Hono } from "hono";

/**
 * Minimal Standard Webhooks receiver.
 *
 * The signing secret was shown ONCE when you ran `sl create subscription`.
 * If you lost it, rotate it from the dashboard: `/subscriptions/<id>` → rotate.
 */

const SIGNING_SECRET = process.env.SIGNING_SECRET;
if (!SIGNING_SECRET) {
	console.error("SIGNING_SECRET not set. Copy .env.example → .env and fill it in.");
	process.exit(1);
}

const app = new Hono();

interface SubgraphEvent {
	type: string;
	timestamp: string;
	data: Record<string, unknown>;
}

app.post("/webhook", async (c) => {
	const body = await c.req.text();
	const headers: Record<string, string> = {};
	c.req.raw.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v;
	});

	if (!verify(body, headers, SIGNING_SECRET)) {
		console.warn("signature verification failed");
		return c.text("unauthorized", 401);
	}

	const event = JSON.parse(body) as SubgraphEvent;
	await onEvent(event);
	return c.text("ok", 200);
});

async function onEvent(event: SubgraphEvent): Promise<void> {
	// TODO: plug in your business logic. `event.type` is
	// `<subgraph>.<table>.created`; `event.data` is the row payload.
	console.log("[event]", event.type, event.data);
}

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`{{NAME}} listening on :${PORT}`);
