import { test, expect, describe } from "bun:test";
import { matchSources } from "../src/runtime/source-matcher.ts";

const txs = [
  { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success", contract_id: "SP000.nft-marketplace", function_name: "list-item" },
  { tx_id: "tx2", type: "contract_call", sender: "SP2", status: "success", contract_id: "SP000.token", function_name: "transfer" },
  { tx_id: "tx3", type: "token_transfer", sender: "SP3", status: "success", contract_id: null, function_name: null },
];

const events = [
  { id: "e1", tx_id: "tx1", type: "smart_contract_event", event_index: 0, data: { contract_identifier: "SP000.nft-marketplace", topic: "listing" } },
  { id: "e2", tx_id: "tx1", type: "nft_transfer_event", event_index: 1, data: { asset_identifier: "SP000.nft-marketplace::nft" } },
  { id: "e3", tx_id: "tx2", type: "ft_transfer_event", event_index: 0, data: { contract_identifier: "SP000.token" } },
];

describe("matchSources", () => {
  test("matches by exact contract", () => {
    const matched = matchSources(
      [{ contract: "SP000.nft-marketplace" }],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.tx.tx_id).toBe("tx1");
    expect(matched[0]!.events.length).toBe(2);
    expect(matched[0]!.sourceKey).toBe("SP000.nft-marketplace");
  });

  test("matches by contract with glob", () => {
    const matched = matchSources(
      [{ contract: "SP000.*" }],
      txs,
      events,
    );
    expect(matched.length).toBe(2); // tx1 and tx2
  });

  test("filters by function name", () => {
    const matched = matchSources(
      [{ contract: "SP000.nft-marketplace", function: "list-item" }],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.tx.function_name).toBe("list-item");
    expect(matched[0]!.sourceKey).toBe("SP000.nft-marketplace::list-item");
  });

  test("filters by event type", () => {
    const matched = matchSources(
      [{ contract: "SP000.nft-marketplace", event: "smart_contract_event" }],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.events.length).toBe(1);
    expect(matched[0]!.events[0]!.type).toBe("smart_contract_event");
  });

  test("filters by topic via event", () => {
    const matched = matchSources(
      [{ contract: "SP000.nft-marketplace", event: "listing" }],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.events.length).toBe(1);
  });

  test("returns empty for no matches", () => {
    const matched = matchSources(
      [{ contract: "SP999.unknown" }],
      txs,
      events,
    );
    expect(matched.length).toBe(0);
  });

  test("skips tx without matching function", () => {
    const matched = matchSources(
      [{ contract: "SP000.nft-marketplace", function: "buy-item" }],
      txs,
      events,
    );
    expect(matched.length).toBe(0);
  });

  test("matches events by contract_identifier when tx doesn't match", () => {
    const extraEvents = [
      ...events,
      { id: "e4", tx_id: "tx3", type: "smart_contract_event", event_index: 0, data: { contract_identifier: "SP999.special" } },
    ];
    const matched = matchSources(
      [{ contract: "SP999.special" }],
      txs,
      extraEvents,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.tx.tx_id).toBe("tx3");
    expect(matched[0]!.events.length).toBe(1);
  });

  // New tests for plural sources + type-based matching

  test("matches multiple sources", () => {
    const matched = matchSources(
      [
        { contract: "SP000.nft-marketplace" },
        { contract: "SP000.token" },
      ],
      txs,
      events,
    );
    expect(matched.length).toBe(2);
    expect(matched.map(m => m.tx.tx_id).sort()).toEqual(["tx1", "tx2"]);
  });

  test("deduplicates by tx_id + sourceKey", () => {
    // Same source twice should not produce duplicate matches
    const matched = matchSources(
      [
        { contract: "SP000.nft-marketplace" },
        { contract: "SP000.nft-marketplace" },
      ],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
  });

  test("matches by transaction type", () => {
    const matched = matchSources(
      [{ type: "token_transfer" }],
      txs,
      events,
    );
    expect(matched.length).toBe(1);
    expect(matched[0]!.tx.tx_id).toBe("tx3");
    expect(matched[0]!.sourceKey).toBe("token_transfer");
  });

  test("matches type-based with minAmount filter", () => {
    const transferEvents = [
      { id: "e5", tx_id: "tx3", type: "stx_transfer_event", event_index: 0, data: { amount: "5000000" } },
    ];
    const matched = matchSources(
      [{ type: "token_transfer", minAmount: 1000000n }],
      txs,
      transferEvents,
    );
    expect(matched.length).toBe(1);
  });

  test("minAmount filters out small amounts", () => {
    const transferEvents = [
      { id: "e5", tx_id: "tx3", type: "stx_transfer_event", event_index: 0, data: { amount: "500" } },
    ];
    const matched = matchSources(
      [{ type: "token_transfer", minAmount: 1000000n }],
      txs,
      transferEvents,
    );
    expect(matched.length).toBe(0);
  });

  test("mixed contract and type sources", () => {
    const matched = matchSources(
      [
        { contract: "SP000.nft-marketplace" },
        { type: "token_transfer" },
      ],
      txs,
      events,
    );
    expect(matched.length).toBe(2);
    const keys = matched.map(m => m.sourceKey).sort();
    expect(keys).toEqual(["SP000.nft-marketplace", "token_transfer"]);
  });
});
