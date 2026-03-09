import { Hono } from "hono";
import { getDb } from "@secondlayer/shared/db";
import { StacksNodeClient } from "@secondlayer/shared/node";
import { searchContracts, getContract, cacheContractAbi } from "@secondlayer/shared/db/queries/contracts";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import type { Contract } from "@secondlayer/shared/db";
import type { ContractSummary, ContractDetail } from "@secondlayer/shared/schemas";

const app = new Hono();

function formatSummary(c: Contract): ContractSummary {
  return {
    contractId: c.contract_id,
    name: c.name,
    deployer: c.deployer,
    deployBlock: c.deploy_block,
    callCount: c.call_count,
    lastCalledAt: c.last_called_at?.toISOString() ?? null,
    createdAt: c.created_at.toISOString(),
  };
}

function formatDetail(c: Contract): ContractDetail {
  return {
    ...formatSummary(c),
    deployTxId: c.deploy_tx_id,
    abi: c.abi ? parseJsonb(c.abi) : null,
    updatedAt: c.updated_at.toISOString(),
  };
}

// Search contracts
app.get("/", async (c) => {
  const q = c.req.query("q");
  if (!q) {
    return c.json({ error: "query param 'q' is required" }, 400);
  }

  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);

  const db = getDb();
  const result = await searchContracts(db, q, limit, offset);

  return c.json({
    contracts: result.contracts.map(formatSummary),
    total: result.total,
  });
});

// Get contract detail
app.get("/:contractId{.+\\..*}", async (c) => {
  const contractId = c.req.param("contractId");

  // If path ends with /abi, handle ABI endpoint
  if (contractId.endsWith("/abi")) {
    const actualId = contractId.slice(0, -4);
    return handleAbi(c, actualId);
  }

  const db = getDb();
  const contract = await getContract(db, contractId);
  if (!contract) {
    return c.json({ error: "Contract not found" }, 404);
  }

  return c.json(formatDetail(contract));
});

// Get contract ABI (explicit route)
app.get("/:contractId{.+\\..*}/abi", async (c) => {
  const contractId = c.req.param("contractId");
  return handleAbi(c, contractId);
});

async function handleAbi(c: any, contractId: string) {
  const db = getDb();
  const contract = await getContract(db, contractId);
  if (!contract) {
    return c.json({ error: "Contract not found" }, 404);
  }

  const refresh = c.req.query("refresh") === "true";

  if (contract.abi && !refresh) {
    return c.json(parseJsonb(contract.abi));
  }

  const node = new StacksNodeClient();
  const abi = await node.getContractAbi(contractId);
  await cacheContractAbi(db, contractId, abi);

  return c.json(abi);
}

export default app;
