import { logger } from "@secondlayer/shared";
import { Hono } from "hono";
import { getConfig } from "./config.ts";

// Parse config on boot — throws if required env is missing.
const cfg = getConfig();

const app = new Hono();

// TODO(day 5): mount auth + tenant routes from ./routes.ts

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

logger.info("Starting provisioner", {
	port: cfg.port,
	imageTag: cfg.imageTag,
	imageOwner: cfg.imageOwner,
	tenantBaseDomain: cfg.tenantBaseDomain,
});

// TODO(day 3): bootstrap readonly role on source DB before accepting requests

const server = Bun.serve({
	port: cfg.port,
	fetch: app.fetch,
});

logger.info("Provisioner ready", { port: cfg.port });

const shutdown = () => {
	logger.info("Shutting down provisioner");
	server.stop();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
