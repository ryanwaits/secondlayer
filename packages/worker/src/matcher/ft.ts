import type { Event } from "@secondlayer/shared/db/schema";
import type {
  FtTransferFilter,
  FtMintFilter,
  FtBurnFilter,
} from "@secondlayer/shared/schemas/filters";
import type { MatchedEvent } from "./types.ts";

/**
 * Match FT transfer events against filter
 */
export function matchFtTransfer(
  filter: FtTransferFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "ft_transfer_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        sender?: string;
        recipient?: string;
        amount?: string;
      };

      // Check asset identifier
      if (filter.assetIdentifier && data.asset_identifier !== filter.assetIdentifier) {
        return false;
      }

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

      return true;
    })
    .map((event) => ({ event, filterType: "ft_transfer" }));
}

/**
 * Match FT mint events against filter
 */
export function matchFtMint(
  filter: FtMintFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "ft_mint_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        recipient?: string;
        amount?: string;
      };

      // Check asset identifier
      if (filter.assetIdentifier && data.asset_identifier !== filter.assetIdentifier) {
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

      return true;
    })
    .map((event) => ({ event, filterType: "ft_mint" }));
}

/**
 * Match FT burn events against filter
 */
export function matchFtBurn(
  filter: FtBurnFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "ft_burn_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        sender?: string;
        amount?: string;
      };

      // Check asset identifier
      if (filter.assetIdentifier && data.asset_identifier !== filter.assetIdentifier) {
        return false;
      }

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
    .map((event) => ({ event, filterType: "ft_burn" }));
}
