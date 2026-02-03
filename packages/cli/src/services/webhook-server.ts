import { verifySignatureHeader } from "@secondlayer/shared/crypto";
import { green, yellow, red, dim, blue } from "../lib/output.ts";

export interface WebhookServerOptions {
  port?: number;
  secret?: string;
  responseCode?: number;
  onWebhook?: (payload: WebhookEvent) => void;
}

export interface WebhookEvent {
  timestamp: Date;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  signatureValid: boolean | null;
}

let server: ReturnType<typeof Bun.serve> | null = null;

export function startWebhookServer(options: WebhookServerOptions = {}): number {
  const port = options.port ?? 3900;
  const responseCode = options.responseCode ?? 200;

  server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      // Health check
      if (path === "/health" && method === "GET") {
        return new Response("OK", { status: 200 });
      }

      // Only accept POST for webhooks
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

        // Verify signature if secret provided
        const signatureHeader = headers["x-streams-signature"];
        if (options.secret && signatureHeader) {
          signatureValid = verifySignatureHeader(
            rawBody,
            signatureHeader,
            options.secret
          );
        }
      } catch {
        body = null;
      }

      const event: WebhookEvent = {
        timestamp: new Date(),
        method,
        path,
        headers,
        body,
        signatureValid,
      };

      // Call callback if provided
      if (options.onWebhook) {
        options.onWebhook(event);
      } else {
        // Default logging
        logWebhook(event);
      }

      return new Response("OK", { status: responseCode });
    },
  });

  return port;
}

export function stopWebhookServer(): void {
  if (server) {
    server.stop();
    server = null;
  }
}

export function isWebhookServerRunning(): boolean {
  return server !== null;
}

function logWebhook(event: WebhookEvent): void {
  const time = event.timestamp.toISOString();
  console.log("");
  console.log(blue("━".repeat(60)));
  console.log(green("⚡ Webhook received"));
  console.log(dim(`   ${time}`));
  console.log(dim(`   ${event.method} ${event.path}`));

  // Signature status
  if (event.signatureValid === true) {
    console.log(green("   ✓ Signature valid"));
  } else if (event.signatureValid === false) {
    console.log(red("   ✗ Signature invalid"));
  } else if (event.headers["x-streams-signature"]) {
    console.log(yellow("   ⚠ Signature not verified (no secret configured)"));
  }

  // Pretty print payload
  if (event.body) {
    console.log(dim("\n   Payload:"));
    const lines = JSON.stringify(event.body, null, 2).split("\n");
    for (const line of lines) {
      console.log(`   ${line}`);
    }
  }

  console.log(blue("━".repeat(60)));
}
