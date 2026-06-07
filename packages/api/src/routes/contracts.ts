import { getSourceDb } from "@secondlayer/shared/db";
import type { Contract } from "@secondlayer/shared/db";
import {
	type Conformance,
	getContract,
	listContractsByTrait,
} from "@secondlayer/shared/db/queries/contracts";
import { Hono } from "hono";

/**
 * Contract discovery — "find all contracts conforming to a trait" (SIP-009/010/013).
 * Backed by the contract registry: `declared` traits parsed from Clarity source,
 * `inferred` standards from static ABI shape-matching. Anonymous public read.
 */
const app = new Hono();

const CONFORMANCE = new Set<Conformance>(["declared", "inferred", "any"]);

/** Public projection — the ABI blob is omitted by default (opt in via ?include=abi). */
function toSummary(c: Contract, includeAbi: boolean) {
	return {
		contract_id: c.contract_id,
		deployer: c.deployer,
		block_height: Number(c.block_height),
		declared_traits: c.declared_traits,
		inferred_standards: c.inferred_standards,
		abi_status: c.abi_status,
		...(includeAbi ? { abi: c.abi } : {}),
	};
}

app.get("/", async (c) => {
	const trait = c.req.query("trait");
	if (!trait) {
		return c.json(
			{ error: "missing required query param `trait`", code: "MISSING_TRAIT" },
			400,
		);
	}
	const conformance = (c.req.query("conformance") ?? "any") as Conformance;
	if (!CONFORMANCE.has(conformance)) {
		return c.json(
			{
				error: "conformance must be one of: declared, inferred, any",
				code: "INVALID_CONFORMANCE",
			},
			400,
		);
	}
	const rawLimit = Number.parseInt(c.req.query("limit") ?? "100", 10);
	const limit = Math.min(
		Math.max(Number.isNaN(rawLimit) ? 100 : rawLimit, 1),
		500,
	);
	const cursor = c.req.query("cursor") || undefined;
	const includeAbi = c.req.query("include") === "abi";

	// `contracts` is a SOURCE-plane table (TABLE_TO_DB.contracts === "source"):
	// read from the chain DB, not the control/target DB, or this 500s with the
	// split live (target has no `contracts` table).
	const db = getSourceDb();
	// Fetch one extra to compute the next cursor without a count query.
	const rows = await listContractsByTrait(db, trait, {
		conformance,
		limit: limit + 1,
		afterId: cursor,
	});
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;

	return c.json({
		contracts: page.map((row) => toSummary(row, includeAbi)),
		next_cursor: hasMore ? page[page.length - 1]?.contract_id : null,
	});
});

// Single contract by id — the prod-safe ABI source (the `/api/node/...` proxy is
// OSS/dedicated-only). Pass ?include=abi for the full ABI blob.
app.get("/:contractId", async (c) => {
	const contractId = c.req.param("contractId");
	const includeAbi = c.req.query("include") === "abi";
	const row = await getContract(getSourceDb(), contractId);
	if (!row) {
		return c.json(
			{
				error: `Contract not found: ${contractId}`,
				code: "CONTRACT_NOT_FOUND",
			},
			404,
		);
	}
	return c.json({ contract: toSummary(row, includeAbi) });
});

export default app;
