# Secondlayer Web App — Agent-Native Product Vision

*Recovered from session 3e096851 (March ~10, 2026)*

---

## The Contradiction

Your pitch says: *"Atomic primitives that work the same way everywhere — as a CLI command, an API call, or a tool an agent picks up in a loop."*

But the chat panel is the opposite of this. It's a chatbot bolted onto a dashboard. It wraps your atomic primitives in a conversational layer that adds friction, not removes it. The irony: your product is already agent-native at the infrastructure level (CLI, SDK, API). The web app just hasn't caught up.

---

## What the Web App Should Be

**Mission Control, not Creator.**

| Role | Do this | Stop doing this |
|------|---------|-----------------|
| **Dashboard** | Monitor health, browse data, see status | Try to replace the CLI/editor |
| **Context Provider** | Generate copy-pasteable commands, skills, configs | Force creation flows that belong in code |
| **Intelligence Layer** | Surface anomalies, explain errors, suggest actions inline | Hide intelligence behind a chat panel |

---

## The Three Redesign Patterns

### 1. Views: "Copy & Go"

Views are TypeScript code. Stop pretending they can be created in a browser. Instead:

**Current (forced):** Chat panel → "create a view" → agent tries to help → still needs CLI

**New pattern:** The web app becomes the *context generator* for your real tools.

- **Contract Explorer**: User pastes or searches a contract address → web app fetches the ABI, shows available functions/events → user checks what they want to index → app generates a complete `defineView()` scaffold
- **One-click export**: "Copy to clipboard" / "Open in Claude Code" / "Download .ts file"
- **For Claude Code users**: Generate a complete skill or `.claude` context file that gives their agent everything it needs — the contract ABI, example events, Secondlayer SDK patterns
- **For Cursor/Windsurf users**: Generate an MCP server config pointing at your API

The web app's job for views is: **"Here's exactly what you need to go build this in your own environment."**

```
┌─────────────────────────────────────────────┐
│  Index this contract                        │
│  SP2C...::marketplace                       │
│                                             │
│  ☑ listing-created (event)                  │
│  ☑ listing-cancelled (event)                │
│  ☐ get-listing (read-only)                  │
│  ☑ buy-listing (public)                     │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ // generated scaffold               │    │
│  │ export default defineView({         │    │
│  │   name: "marketplace-listings",     │    │
│  │   sources: [                        │    │
│  │     { contract: "SP2C...::market",  │    │
│  │       event: "listing-created" },   │    │
│  │   ...                               │    │
│  │                                     │    │
│  │  ⌘C Copy   ↗ Open in editor        │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Or run:                                    │
│  sl views scaffold SP2C...::marketplace     │
└─────────────────────────────────────────────┘
```

### 2. Streams: Inline Intelligence (not chat)

The stream wizard is already good. Don't replace it — augment it with contextual AI at the point of action.

**Pattern: AI as tooltip, not conversation**

- **Contract address field**: User pastes address → AI chips appear: "This contract has 4 public functions, 3 events. Suggest: `contract_call` + `print_event` filters"
- **Filter suggestions**: Based on selected contract, show "Common patterns" — e.g., "DEX trade tracking" auto-configures `contract_call` for swap functions + `print_event` for trade events
- **Error diagnosis**: When a stream shows failed deliveries, inline explanation: "Your webhook returned 502. Last 3 failures at same time — likely a deployment gap."
- **Webhook payload preview**: After selecting filters, show a realistic example payload so devs know what to expect

No chat. No panel. Just intelligence woven into the existing UI surfaces.

### 3. ⌘K as the AI Surface

Kill the chat panel. Upgrade the command palette.

**Current ⌘K**: Static fuzzy search over 11 navigation actions.

**New ⌘K**: Natural language command execution + smart routing.

```
┌──────────────────────────────────────────────┐
│  ⌘K                                          │
│  ┌──────────────────────────────────────────┐│
│  │ pause all streams with failed deliveries ││
│  └──────────────────────────────────────────┘│
│                                              │
│  → Will pause 3 streams:                     │
│    • nft-tracker (12 failed)                 │
│    • dex-monitor (3 failed)                  │
│    • whale-alerts (1 failed)                 │
│                                              │
│  [Enter] Confirm    [Esc] Cancel             │
└──────────────────────────────────────────────┘
```

How it works:
- Still does fuzzy matching for known actions (fast path)
- Falls back to AI interpretation for natural language (slow path)
- AI has access to same tools as the old chat panel
- Results are rendered inline in the palette, not in a separate panel
- Actions execute with confirmation, not conversation

This is the **one AI surface** in the app. It's where intelligence lives. But it's invoked, not ambient.

---

## What to Ship as External Context

The most agent-native thing you can do is **give developers the context their own agents need**.

**Secondlayer Claude Code Skill** (publish as installable skill):
```markdown
# @secondlayer/streams
Create and manage Stacks blockchain event streams.

## Available Commands
- sl streams new <name>
- sl streams register <file>
- sl streams list
...

## Filter Types
[all 13 filter types with examples]

## Example: Track whale STX transfers
[complete working example]
```

**MCP Server** (for Cursor/Windsurf/etc.):
- Expose your API as MCP tools
- Developers add your server, their agent gets full Secondlayer capabilities
- The web app provides the config: "Add to Cursor" → copies MCP JSON

**View Templates Gallery**:
- Curated view definitions for common use cases (DEX tracking, NFT marketplace, token transfers)
- Each template is a complete, working TypeScript file
- Browse in web app → copy → customize → deploy

---

## What to Kill

1. **Agent panel** (FAB + chat) — replace with enhanced ⌘K
2. **Agent API route** (`/api/agent`) — repurpose for ⌘K backend
3. **Generative UI system** (json-render catalog) — overkill for command palette confirmations
4. **"Create a view" in web UI** — replace with scaffold generator + copy/paste

## What to Keep

1. **Stream wizard** — it's good, just add inline AI hints
2. **View monitoring pages** — overview, schema, data browser, reindex
3. **Command palette** — upgrade it, don't replace it
4. **All 12 agent tools** — reuse as ⌘K backend tools

---

## The Essence

Your product is **infrastructure for Stacks developers**. The web app is **mission control** — you monitor, diagnose, and get context. You don't build here. You build in your editor, with your agent, using your CLI.

The most agent-native thing isn't building a chatbot. It's making your primitives so clean that any agent can pick them up. You're already 80% there with the CLI and SDK. The web app just needs to stop competing with the terminal and start complementing it.
