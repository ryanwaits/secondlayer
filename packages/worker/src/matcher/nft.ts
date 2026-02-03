import type { Event } from "@secondlayer/shared/db/schema";
import type {
  NftTransferFilter,
  NftMintFilter,
  NftBurnFilter,
} from "@secondlayer/shared/schemas/filters";
import type { MatchedEvent } from "./types.ts";

/**
 * Match NFT transfer events against filter
 */
export function matchNftTransfer(
  filter: NftTransferFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "nft_transfer_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        sender?: string;
        recipient?: string;
        value?: any;
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

      // Check token ID (if specified)
      if (filter.tokenId && JSON.stringify(data.value) !== filter.tokenId) {
        return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "nft_transfer" }));
}

/**
 * Match NFT mint events against filter
 */
export function matchNftMint(
  filter: NftMintFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "nft_mint_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        recipient?: string;
        value?: any;
      };

      // Check asset identifier
      if (filter.assetIdentifier && data.asset_identifier !== filter.assetIdentifier) {
        return false;
      }

      // Check recipient filter
      if (filter.recipient && data.recipient !== filter.recipient) {
        return false;
      }

      // Check token ID (if specified)
      if (filter.tokenId && JSON.stringify(data.value) !== filter.tokenId) {
        return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "nft_mint" }));
}

/**
 * Match NFT burn events against filter
 */
export function matchNftBurn(
  filter: NftBurnFilter,
  events: Event[]
): MatchedEvent[] {
  return events
    .filter((event) => {
      if (event.type !== "nft_burn_event") return false;

      const data = event.data as {
        asset_identifier?: string;
        sender?: string;
        value?: any;
      };

      // Check asset identifier
      if (filter.assetIdentifier && data.asset_identifier !== filter.assetIdentifier) {
        return false;
      }

      // Check sender filter
      if (filter.sender && data.sender !== filter.sender) {
        return false;
      }

      // Check token ID (if specified)
      if (filter.tokenId && JSON.stringify(data.value) !== filter.tokenId) {
        return false;
      }

      return true;
    })
    .map((event) => ({ event, filterType: "nft_burn" }));
}
