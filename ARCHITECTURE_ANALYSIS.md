# Secondlayer Architecture Analysis: Streams, Subgraphs, and Workflows

## Executive Summary

Secondlayer has three core concepts that developers must learn:

1. **Subgraphs** — Index on-chain events into queryable SQL tables
2. **Streams** — Push matching events to webhook endpoints in real-time  
3. **Workflows** — Multi-step automation with triggers, queries, AI, and delivery

**Current conceptual overhead: 3 separate mental models, 3 deployment patterns, shared filter vocabulary but divergent capabilities.**

---

## 1. Conceptual Relationships

### The Overlap Matrix

| Capability | Subgraphs | Streams | Workflows |
|------------|-----------|---------|-----------|
| Event filters (13 types) | ✅ | ✅ | ✅ |
| Real-time processing | ✅ | ✅ | ✅ |
| Webhook delivery | ❌ | ✅ | ✅ |
| Data persistence | ✅ | ❌ | ❌ (queries only) |
| Multi-step logic | ❌ | ❌ | ✅ |
| AI analysis | ❌ | ❌ | ✅ |
| Scheduled triggers | ❌ | ❌ | ✅ |
| Query indexed data | N/A | ❌ | ✅ |

### Key Insight

**Workflows are a superset that can subsume both streams and subgraph queries.**

- A workflow with `trigger: { type: "stream" }` + single `deliver()` step = **stream**
- A workflow handler that calls `ctx.step.query()` = **subgraph consumer**
- The subgraph itself (indexing layer) is the only unique piece

---

## 2. Developer User Flows

### Current State: Fragmented Setup

#### Flow A: "Alert me on large transfers"
**Option 1 - Stream:**
```typescript
// One-shot webhook delivery
await sl.streams.create({
  name: "whale-alert",
  endpointUrl: "https://my-api.com/webhook",
  filters: [{ type: "stx_transfer", minAmount: 100000000000n }]
})
```

**Option 2 - Workflow:**
```typescript
// Multi-step with AI analysis
export default defineWorkflow({
  name: "whale-alert",
  trigger: { type: "stream", filter: { type: "stx_transfer", minAmount: 100000000000n } },
  handler: async (ctx) => {
    const analysis = await ctx.step.ai("analyze", { ... })
    await ctx.step.deliver("notify", { type: "slack", ... })
  }
})
```

**Developer confusion:** Which should I use? Stream is simpler but workflow is more powerful. No clear guidance.

#### Flow B: "Track DEX activity and alert on price moves"
**Required setup:**
1. Deploy subgraph to index swaps (`defineSubgraph()`)
2. Deploy workflow to query subgraph + analyze (`defineWorkflow()`)
3. Two separate files, two deployment commands, two monitoring surfaces

**Friction points:**
- Must understand both `defineSubgraph()` and `defineWorkflow()` APIs
- Must deploy subgraph first (workflow fails if subgraph doesn't exist)
- No visibility into cross-entity dependencies in UI

---

## 3. Unification Opportunities

### Opportunity 1: Deprecate Streams, Promote "Simple Workflows"

**Hypothesis:** Streams are just workflows with a single `deliver` step.

**Evidence:**
- Stream filters = `StreamTrigger.filter` (same `SubgraphFilter` type)
- Stream delivery = `ctx.step.deliver()` with `type: "webhook"`
- Both support replay/reindex semantics

**Proposal:**
```typescript
// New simplified API - webhook-only workflows
export default defineWorkflow({
  name: "whale-alert",
  trigger: { type: "event", filter: { ... } },
  handler: async (ctx) => {
    // Single deliver step = optimized fast path (current stream infra)
    await ctx.step.deliver("webhook", { type: "webhook", url: "..." })
  }
})
```

**Migration path:**
- Keep stream API for backward compat
- Internally convert to workflow with optimization flag
- Eventually mark streams deprecated in docs

### Opportunity 2: Inline Subgraph Definitions in Workflows

**Problem:** Developers often create 1:1 subgraph-to-workflow relationships. The separation feels artificial.

**Current:**
```typescript
// subgraphs/dex.ts
export default defineSubgraph({ name: "dex-swaps", sources: ..., schema: ..., handlers: ... })

// workflows/price-alert.ts
export default defineWorkflow({
  name: "price-alert",
  trigger: { type: "event", filter: { type: "print_event", topic: "swap" } },
  handler: async (ctx) => {
    const recent = await ctx.step.query("swaps", "dex-swaps", "swaps", { limit: 50 })
    // analyze...
  }
})
```

**Proposed inline API:**
```typescript
export default defineWorkflow({
  name: "price-alert",
  trigger: { type: "event", filter: { type: "print_event", topic: "swap" } },
  
  // Inline table definition - workflow creates/migrates table automatically
  tables: {
    swaps: {
      columns: {
        txId: { type: "text" },
        amountIn: { type: "uint" },
        amountOut: { type: "uint" },
        timestamp: { type: "timestamp" }
      }
    }
  },
  
  handler: async (ctx) => {
    // Auto-persist event + query in same transaction
    await ctx.step.persist("swaps", { txId: ctx.event.txId, ... })
    
    const recent = await ctx.step.query("swaps", { limit: 50, orderBy: { timestamp: "desc" } })
    // analyze...
  }
})
```

**Benefits:**
- One file, one deploy
- Clear data lifecycle (table scoped to workflow)
- Easier mental model: "my workflow has its own table"

### Opportunity 3: Unified "Event Reactions" Mental Model

**New simplified vocabulary:**

| Current | New Concept | Description |
|---------|-------------|-------------|
| Subgraph | **Tables** | Where event data lives |
| Stream | **Deliveries** | Push events to external systems |
| Workflow | **Reactions** | Multi-step event handlers |

**Unified mental model:**
```
When [event matching filter] happens:
  → Persist to [tables] (optional)
  → Query [tables] (optional)
  → Execute [steps: AI, logic, delivery]
```

---

## 4. Proposed Simplified Architecture

### Core Abstraction: **Workflows** (expanded)

Everything is a workflow with optional components:

```typescript
export default defineWorkflow({
  name: "whale-alert",
  
  // WHEN: Event trigger (replaces stream/subgraph sources)
  trigger: { type: "event", filter: { type: "stx_transfer", minAmount: 100000000000n } },
  
  // OR schedule trigger
  // trigger: { type: "schedule", cron: "0 9 * * *" },
  
  // TABLES: Optional inline table definitions (replaces subgraph schema)
  tables: {
    largeTransfers: {
      columns: {
        txId: { type: "text" },
        sender: { type: "principal" },
        amount: { type: "uint" },
        timestamp: { type: "timestamp" }
      },
      indexes: [["sender"], ["timestamp"]]
    }
  },
  
  // HANDLER: What to do (replaces workflow handler + stream delivery)
  handler: async (ctx) => {
    // 1. Persist (was: subgraph handler)
    await ctx.step.persist("largeTransfers", {
      txId: ctx.event.txId,
      sender: ctx.event.sender,
      amount: ctx.event.amount,
      timestamp: ctx.block.timestamp
    })
    
    // 2. Query (existing workflow capability)
    const recent = await ctx.step.query("largeTransfers", {
      where: { sender: ctx.event.sender },
      limit: 10
    })
    
    // 3. Analyze (existing workflow capability)
    const analysis = await ctx.step.ai("analyze", {
      prompt: "Is this whale activity suspicious?",
      schema: { suspicious: { type: "boolean" } }
    })
    
    // 4. Deliver (was: stream webhook delivery)
    if (analysis.suspicious) {
      await ctx.step.deliver("alert", {
        type: "slack",
        channel: "#alerts",
        text: `Suspicious whale: ${ctx.event.sender}`
      })
    }
  }
})
```

### What's Preserved

| Feature | Where It Lives |
|---------|----------------|
| Typed subgraph clients | SDK generates from `tables` schema |
| Reindex/backfill | Workflow-level operation (re-run handler over range) |
| Gaps detection | System-level health check for all tables |
| Webhook signing secrets | Per-workflow delivery config |
| AI step | `ctx.step.ai()` unchanged |
| Query step | `ctx.step.query()` unchanged |

### Migration Strategy

**Phase 1: Internal Unification (no breaking changes)**
- Implement workflows-on-stream-infra optimization
- Add inline table support as "lightweight subgraphs"
- Maintain separate APIs

**Phase 2: Deprecation Warnings**
- Mark streams as "legacy - use simple workflows"
- Mark standalone subgraphs as "advanced - prefer inline tables"

**Phase 3: Unified Documentation**
- Single "Workflows" section with patterns:
  - "Webhook delivery workflow" (was: stream)
  - "Data indexing workflow" (was: subgraph)
  - "Multi-step automation" (current workflow)

---

## 5. Cognitive Load Assessment

### Current State

| Concept | Learning Curve | API Surface | Mental Overhead |
|---------|----------------|-------------|-----------------|
| Subgraphs | High | `defineSubgraph()`, 13 filter types, schema DSL, handlers | Must understand indexing, tables, upserts |
| Streams | Medium | `sl.streams.create()`, filters, webhook handling | Must understand delivery, retries, secrets |
| Workflows | High | `defineWorkflow()`, 4 trigger types, 6 step types | Must understand async steps, context, queries |
| **Total** | **Very High** | **3 APIs, overlapping filters, divergent patterns** | **Context switching between models** |

### Proposed State

| Concept | Learning Curve | API Surface | Mental Overhead |
|---------|----------------|-------------|-----------------|
| Workflows | Medium-High | `defineWorkflow()`, triggers, tables (optional), steps | Single model, progressive complexity |
| **Total** | **Medium-High** | **1 API, optional features, clear progression** | **Unified mental model** |

### Key Simplifications

1. **One `defineWorkflow()` to learn** — tables and deliveries are optional additions
2. **Clear progression path** — start with webhook delivery, add tables, add AI steps
3. **No arbitrary boundaries** — "should this be a stream or workflow?" becomes "do I need multi-step?"

---

## 6. Risks and Trade-offs

### Risks

| Risk | Mitigation |
|------|------------|
| Breaking existing users | Maintain legacy APIs for 12+ months, clear migration guide |
| Performance regression | Keep stream infra as optimized path for single-step workflows |
| Subgraph complexity loss | Preserve standalone `defineSubgraph()` for power users |
| Table proliferation | Add workflow-scoped table cleanup, retention policies |

### What's Lost

- **Explicit subgraph versioning** — would need workflow-level versioning
- **Subgraph marketplace sharing** — would need workflow template sharing
- **Clear indexing vs processing separation** — unified model blurs this line

---

## 7. Recommendation

**Short-term (3 months):**
1. Document current overlap clearly — "When to use streams vs workflows"
2. Add workflow template for "webhook delivery" that mirrors stream setup
3. Add inline table experiment to test ergonomics

**Medium-term (6 months):**
1. Implement fast-path optimization for single-step delivery workflows
2. Deprecate streams API (maintain backend support)
3. Add "simplified workflow" quick-start that hides subgraph complexity

**Long-term (12 months):**
1. Unified `defineWorkflow()` as primary API
2. Subgraphs become "advanced feature" for complex indexing
3. Streams fully migrated to workflow infrastructure

**The simplified mental model:**
> "Secondlayer workflows react to blockchain events. They can persist data to tables, query that data, run AI analysis, and deliver results anywhere. Start simple, grow complex."

---

## Appendix: Current Filter Type Shared Vocabulary

Both streams and workflows (and subgraphs) share these 13 filter types:

- `stx_transfer`, `stx_mint`, `stx_burn`, `stx_lock`
- `ft_transfer`, `ft_mint`, `ft_burn`
- `nft_transfer`, `nft_mint`, `nft_burn`
- `contract_call`, `contract_deploy`, `print_event`

This shared vocabulary is a strength — the unification should preserve it as the common trigger language across all event-driven features.
