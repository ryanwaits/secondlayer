#!/usr/bin/env node
import {
	type IncomingMessage,
	type ServerResponse,
	createServer as createHttpServer,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SessionRegistry } from "./lib/http-sessions.ts";
import { createServer } from "./server.ts";

const port = Number.parseInt(process.env.SECONDLAYER_MCP_PORT || "3100");
const secret = process.env.SECONDLAYER_MCP_SECRET;
const sessions = new SessionRegistry<StreamableHTTPServerTransport>();
sessions.startSweeping();

function authenticate(req: IncomingMessage): boolean {
	if (!secret) return true;
	return req.headers.authorization === `Bearer ${secret}`;
}

const httpServer = createHttpServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		// Only handle /mcp endpoint
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		if (url.pathname !== "/mcp") {
			res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
			return;
		}

		// Auth check
		if (!authenticate(req)) {
			res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		if (req.method === "POST") {
			// Read body with 1MB limit
			const MAX_BODY = 1_048_576;
			const chunks: Buffer[] = [];
			let totalSize = 0;
			for await (const chunk of req) {
				totalSize += (chunk as Buffer).length;
				if (totalSize > MAX_BODY) {
					res
						.writeHead(413)
						.end(JSON.stringify({ error: "Request body too large" }));
					return;
				}
				chunks.push(chunk as Buffer);
			}
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			let body: any;
			try {
				body = JSON.parse(Buffer.concat(chunks).toString());
			} catch {
				res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
				return;
			}

			// Check if this is an initialize request (new session)
			const isInitialize = Array.isArray(body)
				? body.some((m: { method?: string }) => m.method === "initialize")
				: body.method === "initialize";

			if (isInitialize) {
				// Create new session
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
				});
				// Registered before handling so a close that races the first
				// request still drops the session.
				transport.onclose = () => {
					if (transport.sessionId) sessions.delete(transport.sessionId);
				};
				const server = createServer();
				try {
					await server.connect(transport);
					// The session id is assigned while the initialize is handled.
					await transport.handleRequest(req, res, body);
				} catch (err) {
					// A failed init must not leak its transport.
					await transport.close().catch(() => {});
					if (!res.headersSent) {
						res
							.writeHead(500)
							.end(JSON.stringify({ error: "Session initialization failed" }));
					}
					console.error("MCP session init failed:", err);
					return;
				}
				if (transport.sessionId) {
					sessions.add(transport.sessionId, transport);
				} else {
					await transport.close().catch(() => {});
				}
				return;
			}

			// Existing session
			const existing = sessions.get(sessionId);
			if (!existing) {
				res
					.writeHead(400)
					.end(JSON.stringify({ error: "Invalid or missing session ID" }));
				return;
			}
			await existing.handleRequest(req, res, body);
		} else if (req.method === "GET") {
			// SSE stream for existing session
			const existing = sessions.get(sessionId);
			if (!existing) {
				res
					.writeHead(400)
					.end(JSON.stringify({ error: "Invalid or missing session ID" }));
				return;
			}
			await existing.handleRequest(req, res);
		} else if (req.method === "DELETE") {
			// Session teardown
			const transport = sessions.get(sessionId);
			if (sessionId && transport) {
				await transport.handleRequest(req, res);
				await transport.close();
				sessions.delete(sessionId);
			} else {
				res
					.writeHead(400)
					.end(JSON.stringify({ error: "Invalid or missing session ID" }));
			}
		} else {
			res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
		}
	},
);

httpServer.listen(port, () => {
	console.error(`SecondLayer MCP HTTP server listening on port ${port}`);
	if (!secret)
		console.error(
			"Warning: SECONDLAYER_MCP_SECRET not set, authentication disabled",
		);
});
