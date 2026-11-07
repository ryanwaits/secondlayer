import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import type { SubgraphDefinition } from "../types.ts";
import { resolveTraitContracts } from "./block-processor.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const CONTRACT = "SP9.trait-source-token";
const DEPLOY_HEIGHT = 8;

const ENV_KEYS = [
	"INSTANCE_MODE",
	"SOURCE_DATABASE_URL",
	"TARGET_DATABASE_URL",
] as const;

/**
 * `contracts` lives on the source plane. With the planes split, the subgraph
 * target database has no registry rows (or no `contracts` table at all), so a
 * trait source resolved against it matched nothing.
 */
describe.skipIf(!HAS_DB)("trait source resolution on split planes", () => {
	const saved: Record<string, string | undefined> = {};

	beforeAll(async () => {
		for (const key of ENV_KEYS) saved[key] = process.env[key];
		const source = process.env.DATABASE_URL as string;
		// A database with no tables stands in for a target plane with no registry.
		const target = new URL(source);
		target.pathname = `${target.pathname}_t`;
		process.env.INSTANCE_MODE = "platform";
		process.env.SOURCE_DATABASE_URL = source;
		process.env.TARGET_DATABASE_URL = target.toString();

		const db = getSourceDb();
		await db
			.deleteFrom("contracts")
			.where("contract_id", "=", CONTRACT)
			.execute();
		await db
			.insertInto("contracts")
			.values({
				contract_id: CONTRACT,
				deployer: "SP9",
				block_height: DEPLOY_HEIGHT,
				canonical: true,
				abi_status: "fetched",
				inferred_standards: ["sip-010"],
			})
			.execute();
	});

	afterAll(async () => {
		await getSourceDb()
			.deleteFrom("contracts")
			.where("contract_id", "=", CONTRACT)
			.execute();
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	test("reads conforming contracts from the source plane", async () => {
		const subgraph = {
			name: "trait-source-test",
			sources: { transfers: { type: "ft_transfer", trait: "sip-010" } },
		} as unknown as SubgraphDefinition;

		const resolved = await resolveTraitContracts(subgraph, DEPLOY_HEIGHT);

		expect([...(resolved.get("sip-010") ?? [])]).toContain(CONTRACT);
	});
});
