#!/usr/bin/env node
import {
	type IncomingMessage,
	type ServerResponse,
	createServer as createHttpServer,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.ts";

const port = Number.parseInt(process.env.SECONDLAYER_MCP_PORT || "3100");
const secret = process.env.SECONDLAYER_MCP_SECRET;
const sessions = new Map<string, StreamableHTTPServerTransport>();

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
				const server = createServer();
				await server.connect(transport);

				// Store session after handling (sessionId is set after first request)
				await transport.handleRequest(req, res, body);

				if (transport.sessionId) {
					sessions.set(transport.sessionId, transport);
					transport.onclose = () => {
						if (transport.sessionId) sessions.delete(transport.sessionId);
					};
				}
				return;
			}

			// Existing session
			if (!sessionId || !sessions.has(sessionId)) {
				res
					.writeHead(400)
					.end(JSON.stringify({ error: "Invalid or missing session ID" }));
				return;
			}
			await sessions.get(sessionId)!.handleRequest(req, res, body);
		} else if (req.method === "GET") {
			// SSE stream for existing session
			if (!sessionId || !sessions.has(sessionId)) {
				res
					.writeHead(400)
					.end(JSON.stringify({ error: "Invalid or missing session ID" }));
				return;
			}
			await sessions.get(sessionId)!.handleRequest(req, res);
		} else if (req.method === "DELETE") {
			// Session teardown
			if (sessionId && sessions.has(sessionId)) {
				const transport = sessions.get(sessionId)!;
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
