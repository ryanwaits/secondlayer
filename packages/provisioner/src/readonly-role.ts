/**
 * Bootstraps the `secondlayer_readonly` role on the shared source DB.
 *
 * Runs once at provisioner startup. Tenant containers get a URL built with
 * this role — they can SELECT from `blocks`, `transactions`, `events`, etc.
 * but cannot INSERT/UPDATE/DELETE. Prevents a compromised tenant from
 * corrupting shared indexer data.
 *
 * ALTER DEFAULT PRIVILEGES ensures the role auto-SELECTs on future tables
 * (new indexer migrations don't require re-granting).
 */

import { logger } from "@secondlayer/shared";
import postgres from "postgres";
import { getConfig } from "./config.ts";

const ROLE_NAME = "secondlayer_readonly";

export async function bootstrapReadonlyRole(): Promise<void> {
	const cfg = getConfig();
	const admin = postgres(cfg.sourceDbAdminUrl, { max: 1, onnotice: () => {} });

	try {
		// CREATE ROLE IF NOT EXISTS isn't valid Postgres syntax — wrap in DO.
		await admin.unsafe(`
			DO $$
			BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE_NAME}') THEN
					CREATE ROLE ${ROLE_NAME} WITH LOGIN PASSWORD '${cfg.sourceDbReadonlyPassword.replace(/'/g, "''")}';
				ELSE
					ALTER ROLE ${ROLE_NAME} WITH LOGIN PASSWORD '${cfg.sourceDbReadonlyPassword.replace(/'/g, "''")}';
				END IF;
			END $$;
		`);

		await admin.unsafe(
			`GRANT CONNECT ON DATABASE ${cfg.sourceDbName} TO ${ROLE_NAME}`,
		);
		await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE_NAME}`);
		await admin.unsafe(
			`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE_NAME}`,
		);
		await admin.unsafe(
			`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE_NAME}`,
		);

		logger.info("Source DB readonly role ready", { role: ROLE_NAME });
	} finally {
		await admin.end();
	}
}

/**
 * Build the SOURCE_DATABASE_URL value handed to tenant containers. Uses the
 * readonly role + the docker-network-resolvable host (default `sl-pg-source`).
 */
export function buildSourceReadonlyUrl(): string {
	const cfg = getConfig();
	return `postgres://${ROLE_NAME}:${encodeURIComponent(cfg.sourceDbReadonlyPassword)}@${cfg.sourceDbHost}/${cfg.sourceDbName}`;
}
