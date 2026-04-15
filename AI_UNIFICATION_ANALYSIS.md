# Chat/AI UX Unification Analysis

## Executive Summary

The current implementation has **three distinct mental models** for what should be a unified "blockchain automation" interface. Streams (JSON config), subgraphs (TypeScript indexing), and workflows (TypeScript automation) are presented as separate products, confusing the AI and fragmenting the user experience.

---

## Current State: Three Silos

### 1. Streams — "JSON Filter DSL"
```
User intent: "Alert me when large STX transfers happen"
→ scaffold_stream (filters[], endpoint)
→ DeployStreamCard (JSON config display)
→ Tail deliveries
```
- **Paradigm**: Declarative JSON configuration
- **Mental model**: Webhook triggers
- **Authoring**: Filter selection, not code

### 2. Subgraphs — "TypeScript Indexing Scripts"
```
User intent: "Index all swaps from this DEX"
→ scaffold_subgraph (contract ABI → TypeScript)
→ CodeCard (syntax-highlighted TS)
→ DeploySubgraphCard → Tail sync
```
- **Paradigm**: Imperative TypeScript handlers
- **Mental model**: Database indexing
- **Authoring**: Code-first, ABI-driven

### 3. Workflows — "TypeScript Automation"
```
User intent: "Ping Slack every morning with a summary"
→ scaffold_workflow (trigger + steps[])
→ CodeCard (syntax-highlighted TS)
→ DeployWorkflowCard → Tail run
```
- **Paradigm**: Step-based TypeScript orchestration
- **Mental model**: Event-driven automation
- **Authoring**: Code-first, trigger-driven

---

## Key Friction Points

### For Users
1. **"Which tool do I use?"** — Three separate scaffold paths for conceptually similar tasks
2. **Inconsistent confirmation flows** — Streams show JSON, others show TypeScript
3. **Different tail metaphors** — deliveries vs sync vs run

### For the AI (instructions.ts)
1. **168 lines of branching logic** — Separate sections for each resource type
2. **Different STOP points** — All three require "scaffold → STOP → ask → deploy" but described differently
3. **Read-only handling duplicated** — Same pattern, three different wordings

### For Developers
1. **1788-line tool-part-renderer.tsx** — Exploded complexity from N×M tool×card combinations
2. **Duplicated card components** — DeploySubgraphCard and DeployWorkflowCard are 96 lines each, nearly identical
3. **Tool name inconsistency** — `check_streams` vs `streams_list`, `scaffold_subgraph` vs `scaffold_from_contract`

---

## Unification Opportunities

### Opportunity 1: Unified "Resource" Abstraction

**Current:**
```typescript
// 31 separate tools
check_streams, check_subgraphs, check_workflows
scaffold_stream, scaffold_subgraph, scaffold_workflow
deploy_stream, deploy_subgraph, deploy_workflow
read_stream, read_subgraph, read_workflow
edit_stream, edit_subgraph, edit_workflow
```

**Proposed:**
```typescript
// 4 unified tools + 1 per resource type
list_resources({ type: "stream|subgraph|workflow" })
scaffold_resource({ type, intent }) → returns { code, config, language }
deploy_resource({ type, artifact })
read_resource({ type, name })
propose_edit({ type, name, proposedArtifact })

// Plus specific operations
tail_resource({ type, name, runId? })  // deliveries, sync, run unified
manage_resource({ type, action, targets })
```

**Impact:**
- instructions.ts → ~50% shorter
- tool-part-renderer → 1/3 the size with generic ResourceCard
- Factory pattern already supports this abstraction

---

### Opportunity 2: Unified "AI Persona" — The Stacks Automation Engineer

**Current persona (fragmented):**
```
"You are the Secondlayer AI assistant. Secondlayer is a developer platform... 
[streams are JSON] [subgraphs are TypeScript for indexing] [workflows are TypeScript for automation]"
```

**Proposed unified persona:**
```
You are the Secondlayer AI — an expert Stacks blockchain automation engineer.

Your job: Turn any user intent into running blockchain infrastructure.

Secondlayer has three resource types for different automation needs:
- **Streams**: Real-time webhooks. "Tell my server when X happens on-chain."
- **Subgraphs**: Queryable databases. "Index on-chain data so I can query it later."  
- **Workflows**: Smart automation. "Do something intelligent when X happens."

All three follow the same pattern: SCAFFOLD → REVIEW → DEPLOY → OPERATE.
Only the artifact type differs: Streams return JSON configs, Subgraphs and Workflows return TypeScript.

Rules:
1. ALWAYS scaffold first — never deploy in the same step
2. ALWAYS stop and ask for confirmation before deploying
3. ALWAYS offer to tail/monitor after deploying
4. NEVER explain the differences between resource types unless asked
```

**Key shift:** Present as "one product, three resource types" not "three products."

---

### Opportunity 3: Unified Card Components

**Current duplication:**
```
DeploySubgraphCard.tsx   (96 lines)
DeployWorkflowCard.tsx   (96 lines, identical structure)
DeployStreamCard.tsx     (different, but similar pattern)
StreamConfigCard.tsx     (displays JSON)
CodeCard.tsx             (displays TypeScript)
```

**Proposed generic components:**
```
ResourceScaffoldCard     { type, artifact, onConfirm }
ResourceDiffCard          { type, current, proposed, onConfirm }
ResourceDeployCard        { type, name, summary, phase, onConfirm }
ResourceTailCard          { type, resourceName, runId?, liveData }
```

**Render mapping unified:**
```typescript
const RESOURCE_CONFIG = {
  stream: { 
    language: 'json', 
    tailType: 'deliveries',
    displayName: 'Stream',
    confirmPhrase: 'POST to endpoint'
  },
  subgraph: { 
    language: 'typescript', 
    tailType: 'sync',
    displayName: 'Subgraph',
    confirmPhrase: 'Index from start block'
  },
  workflow: { 
    language: 'typescript', 
    tailType: 'run',
    displayName: 'Workflow',
    confirmPhrase: 'Trigger on deploy'
  }
};
```

---

### Opportunity 4: Tool Naming Alignment (Web ↔ MCP)

**Current misalignment:**
| Web | MCP | Unified |
|-----|-----|---------|
| check_streams | streams_list | resources.list({type:"stream"}) |
| scaffold_subgraph | scaffold_from_contract | resources.scaffold({type:"subgraph"}) |
| deploy_workflow | workflows_deploy | resources.deploy({type:"workflow"}) |
| tail_deliveries | streams_deliveries | resources.tail({type:"stream"}) |
| edit_workflow | workflows_propose_edit | resources.propose_edit({type:"workflow"}) |

**Benefit:** Users can switch between chat and MCP without relearning vocabulary.

---

### Opportunity 5: Instructions Consolidation

**Current (168 lines):**
```
## Stream authoring
- Streams are NOT TypeScript...
- Call scaffold_stream...
- STOP after scaffold...

## Subgraph authoring
- When user asks to index...
- Call scaffold_subgraph...
- STOP after scaffold...

## Workflow authoring
- When user describes automation...
- Call scaffold_workflow...
- STOP after scaffold...
```

**Proposed (~80 lines):**
```
## Resource authoring (all types)
When the user wants to create any resource (stream, subgraph, workflow):
1. Call the scaffold tool for that resource type
2. STOP — describe what was generated in 1-2 sentences
3. ASK if they want to (a) deploy as-is, (b) customize, or (c) restart
4. NEVER deploy in the same step as scaffold

Type-specific notes:
- Streams: JSON config with filters, not TypeScript. Show signing secret after deploy.
- Subgraphs: TypeScript with defineSubgraph(). Fetches ABI automatically.
- Workflows: TypeScript with defineWorkflow(). Has steps: run/query/ai/deliver.

## Resource editing (all types)
Editing ANY resource is a two-step flow:
1. Call read_{type} first — capture sourceCode/version
2. Call edit_{type} with currentCode, proposedCode, summary
3. Mention: "Edits take effect for new runs. In-flight runs use previous version."
```

---

## Implementation Roadmap

### Phase 1: Card Consolidation (Low Risk)
- Create `ResourceDeployCard` generic component
- Migrate `DeploySubgraphCard` → `ResourceDeployCard`
- Migrate `DeployWorkflowCard` → `ResourceDeployCard`
- Consolidate `StreamConfigCard` into `CodeCard` (add JSON language support)

### Phase 2: Tool Refactoring (Medium Risk)
- Add unified `resources.*` tool namespace alongside existing tools
- Implement adapter layer: `resources.scaffold({type})` calls existing scaffold_X
- Update `tool-part-renderer.tsx` to route by `type` parameter
- Keep old tools for backward compatibility

### Phase 3: Instructions Rewrite (Medium Risk)
- Rewrite instructions.ts with unified persona
- Add unified "Resource Authoring" section
- Simplify type-specific guidance to footnotes
- A/B test with internal users

### Phase 4: MCP Alignment (Low Risk)
- Add `resources_*` tools to MCP that mirror web unified tools
- Deprecate verb-noun naming (streams_list) in favor of resource-scoped
- Document migration path

### Phase 5: Full Migration (High Risk — post-validation)
- Remove legacy tool definitions
- Delete duplicate card components
- Update all tests

---

## Expected Outcomes

| Metric | Current | After Unification |
|--------|---------|-------------------|
| instructions.ts lines | 168 | ~90 (-46%) |
| tool-part-renderer.tsx lines | 1788 | ~600 (-66%) |
| Deploy card components | 3 (288 lines) | 1 (96 lines) |
| Scaffold tools | 3 | 1 with type param |
| AI persona clarity | Fragmented | Unified |
| User cognitive load | High (3 products) | Low (1 product, 3 modes) |

---

## Risk Mitigation

1. **Regression in AI behavior** — Maintain legacy tool definitions as aliases during transition
2. **User confusion** — Keep UI visually distinct (badges, icons) even if code is unified
3. **MCP compatibility** — Version the MCP server, keep old tools available
4. **Edge cases** — Streams truly are different (JSON vs TS) — don't over-unify

---

## Recommended Immediate Actions

1. **Extract generic `ResourceDeployCard`** — 2 hour refactor, immediate code reduction
2. **Add unified persona paragraph to instructions.ts** — 30 min, immediate clarity improvement
3. **Create `RESOURCE_CONFIG` constant** — 1 hour, enables further consolidation
4. **Document the "three resource types" mental model** — Help users understand the product boundaries
