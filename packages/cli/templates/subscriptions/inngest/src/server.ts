import { serve } from "inngest/hono";
import { Hono } from "hono";
import { inngest, onSubgraphEvent } from "./inngest.ts";

const app = new Hono();
app.on(
	["GET", "POST", "PUT"],
	"/api/inngest",
	serve({ client: inngest, functions: [onSubgraphEvent] }),
);

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`{{NAME}} (Inngest host) listening on :${PORT}`);
