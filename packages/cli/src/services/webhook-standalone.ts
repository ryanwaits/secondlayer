#!/usr/bin/env bun
// Standalone webhook server for background mode
import { verifySignatureHeader } from "@secondlayer/shared/crypto";

const PORT = parseInt(process.env.PORT || "3900");
const SECRET = process.env.WEBHOOK_SECRET;

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    if (path === "/health" && method === "GET") {
      return new Response("OK", { status: 200 });
    }

    if (method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let body: unknown;
    let signatureValid: boolean | null = null;

    try {
      const rawBody = await req.text();
      body = JSON.parse(rawBody);

      const signatureHeader = headers["x-streams-signature"];
      if (signatureHeader && SECRET) {
        signatureValid = verifySignatureHeader(rawBody, signatureHeader, SECRET);
      } else if (signatureHeader && !SECRET) {
        // Signature sent but no secret configured to verify against
        signatureValid = null;
      }
    } catch {
      body = null;
    }

    // Log to stdout (captured to log file in background mode)
    const time = new Date().toISOString();
    console.log(JSON.stringify({
      type: "webhook",
      timestamp: time,
      method,
      path,
      signatureValid,
      body,
    }));

    return new Response("OK", { status: 200 });
  },
});

console.log(`Webhook server listening on port ${PORT}`);

// Graceful shutdown
const shutdown = () => {
  console.log("Shutting down webhook server...");
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
