import { logger } from "@secondlayer/shared";
import { StacksNodeClient } from "@secondlayer/shared/node";
import { Hono } from "hono";

const app = new Hono();

app.get("/contracts/:contractId{.+\\..*}/abi", async (c) => {
	const contractId = c.req.param("contractId");
	const node = new StacksNodeClient();

	try {
		const abi = await node.getContractAbi(contractId);
		return c.json(abi);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("404")) {
			return c.json({ error: "Contract not found" }, 404);
		}
		logger.warn("node.abi_fetch_failed", { contractId, error: msg });
		return c.json({ error: "Failed to fetch contract ABI" }, 502);
	}
});

export default app;
