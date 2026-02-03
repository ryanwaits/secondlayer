import type { Event, Transaction } from "@secondlayer/shared/db/schema";
import type {
  ContractCallFilter,
  ContractDeployFilter,
  PrintEventFilter,
} from "@secondlayer/shared/schemas/filters";
import type { MatchedEvent, MatchedTransaction } from "./types.ts";

/**
 * Check if a string matches a pattern (supports * wildcard)
 */
function matchPattern(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return value === pattern;
  }

  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*/g, ".*"); // Replace * with .*

  return new RegExp(`^${regexPattern}$`).test(value);
}

/**
 * Match contract call transactions against filter
 */
export function matchContractCall(
  filter: ContractCallFilter,
  transactions: Transaction[]
): MatchedTransaction[] {
  return transactions
    .filter((tx) => {
      if (tx.type !== "contract_call") return false;

      // Check contract ID
      if (filter.contractId && tx.contract_id !== filter.contractId) {
        return false;
      }

      // Check function name (supports wildcards)
      if (filter.functionName && tx.function_name) {
        if (!matchPattern(tx.function_name, filter.functionName)) {
          return false;
        }
      } else if (filter.functionName && !tx.function_name) {
        return false;
      }

      // Check caller
      if (filter.caller && tx.sender !== filter.caller) {
        return false;
      }

      return true;
    })
    .map((transaction) => ({ transaction, filterType: "contract_call" }));
}

/**
 * Match contract deploy transactions against filter
 */
export function matchContractDeploy(
  filter: ContractDeployFilter,
  transactions: Transaction[]
): MatchedTransaction[] {
  return transactions
    .filter((tx) => {
      if (tx.type !== "smart_contract") return false;

      // Check deployer
      if (filter.deployer && tx.sender !== filter.deployer) {
        return false;
      }

      // Check contract name pattern
      if (filter.contractName && tx.contract_id) {
        // Extract contract name from contract ID (format: address.name)
        const name = tx.contract_id.split(".")[1] || "";
        if (!matchPattern(name, filter.contractName)) {
          return false;
        }
      }

      return true;
    })
    .map((transaction) => ({ transaction, filterType: "contract_deploy" }));
}

/**
 * Match print events (smart contract events) against filter
 */
export function matchPrintEvent(
  filter: PrintEventFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "smart_contract_event") return false;

      const data = event.data as {
        contract_identifier?: string;
        topic?: string;
        value?: any;
      };

      // Check contract ID
      if (filter.contractId && data.contract_identifier !== filter.contractId) {
        return false;
      }

      // Check topic
      if (filter.topic && data.topic !== filter.topic) {
        return false;
      }

      // Check if event data contains substring
      if (filter.contains) {
        const valueStr = JSON.stringify(data.value);
        if (!valueStr.includes(filter.contains)) {
          return false;
        }
      }

      return true;
    })
    .map((event) => ({ event, filterType: "print_event" }));
}
