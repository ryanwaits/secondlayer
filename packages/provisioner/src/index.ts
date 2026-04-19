import { logger } from "@secondlayer/shared";
import { Hono } from "hono";
import { getConfig } from "./config.ts";
import { bootstrapReadonlyRole } from "./readonly-role.ts";
import { buildRoutes } from "./routes.ts";

// Parse config on boot — throws if required env is missing.
const cfg = getConfig();

logger.info("Starting provisioner", {
	port: cfg.port,
	imageTag: cfg.imageTag,
	imageOwner: cfg.imageOwner,
	tenantBaseDomain: cfg.tenantBaseDomain,
});

// Bootstrap the source DB readonly role before accepting requests. Fails
// fast if admin creds are wrong — provisioner is useless without this.
try {
	await bootstrapReadonlyRole();
} catch (err) {
	logger.error("Failed to bootstrap source DB readonly role", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
}

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));
app.route("/", buildRoutes());

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
