/**
 * Run the shared migrations against a freshly-provisioned tenant DB.
 *
 * The API image contains the migration entrypoint at
 * `packages/shared/src/db/migrate.ts`. We spawn a throwaway container of that
 * image pointed at the tenant PG, wait for exit, then remove it.
 */

import { logger } from "@secondlayer/shared";
import { type ProvisionerConfig, imageName } from "./config.ts";
import {
	containerCreate,
	containerInspect,
	containerRemove,
	containerStart,
} from "./docker.ts";

const MIGRATOR_SUFFIX = "-migrator";

export async function runMigrations(
	cfg: ProvisionerConfig,
	slug: string,
	targetDatabaseUrl: string,
	networks: string[],
): Promise<void> {
	const name = `sl-pg-${slug}${MIGRATOR_SUFFIX}`;

	// Create a short-lived container that runs `bun run migrate.ts` against the
	// tenant DB. Using the API image because it has the migration script baked in.
	const image = imageName(cfg, "api");
	const id = await containerCreate({
		name,
		image,
		env: { DATABASE_URL: targetDatabaseUrl, NODE_ENV: "production" },
		cmd: ["bun", "run", "packages/shared/src/db/migrate.ts"],
		networks,
		labels: { "secondlayer.role": "migrator", "secondlayer.slug": slug },
		memoryMb: 512,
		cpus: 0.5,
		restartPolicy: "no",
	});

	try {
		await containerStart(id);
		// Migration script exits on completion. Poll inspect for Running=false.
		const deadline = Date.now() + 2 * 60_000;
		while (Date.now() < deadline) {
			const info = await containerInspect(id);
			if (!info) throw new Error(`Migrator container ${name} vanished`);
			if (!info.State.Running) {
				logger.info("Tenant DB migrations complete", { slug });
				return;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
		throw new Error(`Migrator for ${slug} timed out`);
	} finally {
		await containerRemove(id).catch(() => {
			// Best-effort cleanup of the migrator container.
		});
	}
}
