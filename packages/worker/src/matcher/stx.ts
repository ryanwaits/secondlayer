import type { Event } from "@secondlayer/shared/db/schema";
import type {
  StxTransferFilter,
  StxMintFilter,
  StxBurnFilter,
  StxLockFilter,
} from "@secondlayer/shared/schemas/filters";
import type { MatchedEvent } from "./types.ts";

/**
 * Match STX transfer events against filter
 */
export function matchStxTransfer(
  filter: StxTransferFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "stx_transfer_event") return false;

      const data = event.data as {
        sender?: string;
        recipient?: string;
        amount?: string;
      };

      // Check sender filter
      if (filter.sender && data.sender !== filter.sender) {
        return false;
      }

      // Check recipient filter
      if (filter.recipient && data.recipient !== filter.recipient) {
        return false;
      }

      // Check min amount
      if (filter.minAmount !== undefined) {
        const amount = parseInt(data.amount || "0", 10);
        if (amount < filter.minAmount) return false;
      }

      // Check max amount
      if (filter.maxAmount !== undefined) {
        const amount = parseInt(data.amount || "0", 10);
        if (amount > filter.maxAmount) return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "stx_transfer" }));
}

/**
 * Match STX mint events against filter
 */
export function matchStxMint(
  filter: StxMintFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "stx_mint_event") return false;

      const data = event.data as {
        recipient?: string;
        amount?: string;
      };

      // Check recipient filter
      if (filter.recipient && data.recipient !== filter.recipient) {
        return false;
      }

      // Check min amount
      if (filter.minAmount !== undefined) {
        const amount = parseInt(data.amount || "0", 10);
        if (amount < filter.minAmount) return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "stx_mint" }));
}

/**
 * Match STX burn events against filter
 */
export function matchStxBurn(
  filter: StxBurnFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "stx_burn_event") return false;

      const data = event.data as {
        sender?: string;
        amount?: string;
      };

      // Check sender filter
      if (filter.sender && data.sender !== filter.sender) {
        return false;
      }

      // Check min amount
      if (filter.minAmount !== undefined) {
        const amount = parseInt(data.amount || "0", 10);
        if (amount < filter.minAmount) return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "stx_burn" }));
}

/**
 * Match STX lock events against filter
 */
export function matchStxLock(
  filter: StxLockFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "stx_lock_event") return false;

      const data = event.data as {
        locked_address?: string;
        locked_amount?: string;
      };

      // Check locked address filter
      if (filter.lockedAddress && data.locked_address !== filter.lockedAddress) {
        return false;
      }

      // Check min amount
      if (filter.minAmount !== undefined) {
        const amount = parseInt(data.locked_amount || "0", 10);
        if (amount < filter.minAmount) return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "stx_lock" }));
}
