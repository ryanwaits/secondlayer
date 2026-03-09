import type { Command } from "commander";
import {
  searchContracts,
  getContractInfo,
  getContractAbi,
  handleApiError,
} from "../lib/api-client.ts";
import { formatTable, formatKeyValue, dim } from "../lib/output.ts";

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

export function registerContractsCommand(program: Command): void {
  const contracts = program
    .command("contracts")
    .description("Discover and inspect on-chain contracts");

  contracts
    .command("search <query>")
    .description("Search contracts by name")
    .option("-l, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query: string, options: { limit: string; json?: boolean }) => {
      try {
        const limit = parseInt(options.limit, 10) || 20;
        const result = await searchContracts(query, { limit });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.contracts.length === 0) {
          console.log("No contracts found");
          return;
        }

        const rows = result.contracts.map((c: any) => [
          c.name,
          truncate(c.contractId, 20),
          truncate(c.deployer, 20),
          c.callCount.toString(),
          c.lastCalledAt ? new Date(c.lastCalledAt).toLocaleDateString() : "-",
        ]);

        console.log(formatTable(["Name", "Contract ID", "Deployer", "Calls", "Last Called"], rows));
        console.log(dim(`\n${result.total} contract(s) total`));
      } catch (err) {
        handleApiError(err, "search contracts");
      }
    });

  contracts
    .command("info <contractAddress>")
    .description("Show contract details")
    .option("--json", "Output as JSON")
    .action(async (contractAddress: string, options: { json?: boolean }) => {
      try {
        const contract = await getContractInfo(contractAddress);

        if (options.json) {
          console.log(JSON.stringify(contract, null, 2));
          return;
        }

        console.log(
          formatKeyValue([
            ["Contract ID", contract.contractId],
            ["Name", contract.name],
            ["Deployer", contract.deployer],
            ["Deploy Block", contract.deployBlock.toString()],
            ["Deploy TX", contract.deployTxId],
            ["Call Count", contract.callCount.toString()],
            ["Last Called", contract.lastCalledAt ? new Date(contract.lastCalledAt).toLocaleString() : "-"],
            ["Has ABI", contract.abi ? "yes" : "no"],
          ]),
        );
      } catch (err) {
        handleApiError(err, "get contract info");
      }
    });

  contracts
    .command("abi <contractAddress>")
    .description("Fetch and display contract ABI")
    .option("--json", "Output raw ABI as JSON")
    .action(async (contractAddress: string, options: { json?: boolean }) => {
      try {
        const abi = (await getContractAbi(contractAddress)) as any;

        if (options.json) {
          console.log(JSON.stringify(abi, null, 2));
          return;
        }

        // Pretty-print function list
        const fns = abi.functions as Array<{ name: string; access: string; args: Array<{ name: string; type: unknown }> }> | undefined;
        if (!fns || fns.length === 0) {
          console.log("No functions found in ABI");
          return;
        }

        const rows = fns.map((f) => [
          f.name,
          f.access,
          f.args.map((a) => a.name).join(", ") || "-",
        ]);

        console.log(formatTable(["Function", "Access", "Args"], rows));
        console.log(dim(`\n${fns.length} function(s)`));
      } catch (err) {
        handleApiError(err, "get contract ABI");
      }
    });
}
