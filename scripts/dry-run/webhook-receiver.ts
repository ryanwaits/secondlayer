type RecordedEvent = {
	id: number;
	path: string;
	method: string;
	receivedAt: string;
	headers: Record<string, string>;
	body: string;
	bodyJson: unknown | null;
};

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const maxEvents = Number.parseInt(process.env.WEBHOOK_MAX_EVENTS ?? "500", 10);
const adminToken = process.env.WEBHOOK_RECEIVER_TOKEN;
const events: RecordedEvent[] = [];
let nextId = 1;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
	console.log(`Local webhook receiver for beta dry-runs.

Usage:
  bun run dry-run:webhook

Env:
  PORT=3000
  PUBLIC_WEBHOOK_URL=https://unrimed-kali-anaerobiotically.ngrok-free.app
  WEBHOOK_RECEIVER_TOKEN=<optional token for GET/DELETE /events>

Routes:
  POST /ok       record request, return 200
  POST /fail     record request, return 500
  GET /events    list recorded requests
  DELETE /events clear recorded requests
  GET /health    health check
`);
	process.exit(0);
}

function json(data: unknown, init: ResponseInit = {}): Response {
	return Response.json(data, {
		...init,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
			"access-control-allow-headers": "content-type,authorization",
			...(init.headers ?? {}),
		},
	});
}

function authorized(req: Request): boolean {
	if (!adminToken) return true;
	const auth = req.headers.get("authorization");
	const queryToken = new URL(req.url).searchParams.get("token");
	return auth === `Bearer ${adminToken}` || queryToken === adminToken;
}

async function record(req: Request): Promise<RecordedEvent> {
	const body = await req.text();
	let bodyJson: unknown | null = null;
	try {
		bodyJson = body ? JSON.parse(body) : null;
	} catch {
		bodyJson = null;
	}

	const url = new URL(req.url);
	const event: RecordedEvent = {
		id: nextId,
		path: url.pathname,
		method: req.method,
		receivedAt: new Date().toISOString(),
		headers: Object.fromEntries(req.headers.entries()),
		body,
		bodyJson,
	};
	nextId += 1;
	events.unshift(event);
	if (events.length > maxEvents) events.length = maxEvents;
	return event;
}

function printStartup(): void {
	const publicUrl =
		process.env.PUBLIC_WEBHOOK_URL ??
		"https://unrimed-kali-anaerobiotically.ngrok-free.app";
	console.log(`Webhook receiver listening on http://localhost:${port}`);
	console.log("");
	console.log("Use:");
	console.log(`  OK_WEBHOOK_URL=${publicUrl.replace(/\/$/, "")}/ok`);
	console.log(`  FAIL_WEBHOOK_URL=${publicUrl.replace(/\/$/, "")}/fail`);
	console.log("");
	console.log("Inspect:");
	console.log(`  curl http://localhost:${port}/events`);
	console.log(`  curl -X DELETE http://localhost:${port}/events`);
	if (adminToken) {
		console.log("");
		console.log("Admin reads require:");
		console.log("  Authorization: Bearer $WEBHOOK_RECEIVER_TOKEN");
	}
}

const server = Bun.serve({
	port,
	async fetch(req) {
		if (req.method === "OPTIONS") return json({ ok: true });

		const url = new URL(req.url);

		if (url.pathname === "/health") {
			return json({ ok: true, events: events.length });
		}

		if (url.pathname === "/events") {
			if (!authorized(req))
				return json({ error: "Unauthorized" }, { status: 401 });
			if (req.method === "GET") return json({ events });
			if (req.method === "DELETE") {
				events.length = 0;
				return json({ ok: true });
			}
			return json({ error: "Method not allowed" }, { status: 405 });
		}

		if (req.method !== "POST") {
			return json({ error: "Not found" }, { status: 404 });
		}

		if (url.pathname === "/ok" || url.pathname === "/fail") {
			const event = await record(req);
			const status = url.pathname === "/ok" ? 200 : 500;
			console.log(
				`${event.receivedAt} ${event.path} -> ${status} id=${event.id} webhook-id=${
					event.headers["webhook-id"] ?? "none"
				}`,
			);
			return json(
				{
					ok: status < 300,
					id: event.id,
					receivedAt: event.receivedAt,
				},
				{ status },
			);
		}

		const event = await record(req);
		console.log(`${event.receivedAt} ${event.path} -> 404 id=${event.id}`);
		return json({ error: "Not found", id: event.id }, { status: 404 });
	},
});

printStartup();

process.on("SIGINT", () => {
	server.stop(true);
	process.exit(0);
});
