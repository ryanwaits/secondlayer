# Index vs Streams: one event type vs a type set

Status: accepted (31 Jul 2026). Verified by three independent audits; this
records what previously lived only in code comments and a bench report.

## The rule

`GET /v1/index/events` takes exactly ONE `event_type`. `GET /v1/streams/events`
takes a `types` SET (plus `not_types`, plus labelled OR-groups). This is not
naming drift. Do not unify them.

## Why Index is single-type

**Physical.** The composite index is `(event_type, block_height, event_index)
WHERE canonical` (migration 0087). A scalar `event_type` collapses the leading
column; the row-values keyset `(block_height, event_index) > (x, y)` becomes an
index range-scan — a seek. `event_type IN (a, b)` yields k sorted runs the
planner cannot merge for `ORDER BY … LIMIT n` without sorting the full window.
Measured: cursor pages over `print` cost ~6,800ms each before the sargable
single-type keyset; 0.37ms after (`packages/subgraphs/bench/RESULTS.md`).
Multi-VALUE `contract_id` is fine precisely BECAUSE event_type stays scalar and
keeps supplying the order.

**Vocabulary.** `INDEX_EVENT_CONFIG` is per-type: allowed filters, equality
filters (which may lead the ORDER BY), `fields` sets, `requiredNonNull`
predicates. A multi-type request has no single grammar — its filter set
collapses to the intersection, and its WHERE becomes OR-of-ANDs, the exact
non-sargable shape above.

**Types.** The singular `eventType` is the SDK's only inference site for
`IndexEventOf<T>` — it is what makes rows narrow and `fields` checkable per
type. Streams' own SDK is the proof of the alternative: `types[]` returns the
full union, always.

## Why Streams is a type set

**The cursor is filter-invariant.** `stream_event_index` is a dense per-block
ordinal computed over the FULL all-types event set ("cursor-stability
contract", tested). One checkpoint therefore spans any type subset, and labels
can change between restarts without invalidating it.

**Consumers need it.** The sBTC token decoder consumes ft_transfer + ft_mint +
ft_burn under ONE checkpoint — supply conservation breaks on separate clocks.
`not_types`, labelled OR-groups ("two concerns, one scan, one cursor"), parquet
dumps (block-partitioned, all-type) and `replay()`'s dump→live seam only exist
over a set.

## The unification layer is the filter union, not the params

`on` (`@secondlayer/stacks/filters`) is the single authoring vocabulary;
explicit projections (`toIndexParams` / `toStreamsParams` / `toChainTrigger` /
`toSubgraphSource`) translate per surface and THROW on what a surface cannot
express. This catches drift loudly: the ft `asset_identifier` rejection
(fixed 30 Jul, sdk 6.46.0) was found by a projection within a day of the union
shipping.

## Sanctioned conveniences (do these; nothing more)

- Streams MAY accept `event_type=<single>` as an alias folded into `types`.
- Index MAY accept `types=<single>` as an alias; two or more values are
  rejected with a message citing this document.
- CLI flags accept both spellings on both commands.
- A fan-out multi-type Index read (N seeks + k-way merge) is SOUND (the cursor
  ordinal is shared and filter-invariant; our subgraph runtime already does N
  single-type walks merged by event_index over exhausted height ranges) but
  REJECTED as an endpoint: it silently N-times the read cost per billed row,
  requires watermark truncation (a silent-data-loss bug class), and collapses
  the per-type vocabulary to its intersection. Revisit only with a concrete
  consumer that cannot use N walks + client merge.
