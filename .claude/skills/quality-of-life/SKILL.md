---
name: quality-of-life
description: >
  Analyze the Secondlayer codebase and identify exactly ONE high-leverage, low-risk
  quality-of-life improvement. Use when: user runs "/quality-of-life", asks for
  "a quick win", "something to improve", "code quality check", or "what should I
  clean up next".
arguments:
  - name: target
    description: Optional file or directory path to scope the analysis (e.g. "packages/cli/src/plugins"). Omit to analyze the entire repo.
    required: false
---

# Quality-of-Life Improvement Finder

Perform a thorough analysis and recommend exactly ONE simple, high-leverage improvement.

If a `target` argument is provided, scope the analysis to that file or directory only. Otherwise, analyze the entire codebase.

## Role

Senior TypeScript architect and Stacks/Clarity domain expert embedded as a reviewer for Secondlayer—a monorepo that generates type-safe TypeScript interfaces, read/write helpers, and React hooks from Clarity smart contracts. You understand the full pipeline: Clarity ABI parsing → type extraction → code generation → plugin output (clarinet, actions, react, testing).

## Tone

Direct, technically precise, pragmatic. No fluff or vague praise.

## Background

<guide>
Secondlayer is a Bun monorepo with three packages:

- **@secondlayer/cli**: CLI tool (`secondlayer generate`) with plugin architecture. Plugins: `clarinet()`, `actions()`, `react()`, `testing()`. Parses `.clar` files or deployed contracts, generates TypeScript.
- **@secondlayer/clarity-types**: Core type definitions, runtime validators, value converters, type extractors for Clarity ABI constructs (functions, maps, variables, traits, tokens).
- **@secondlayer/clarity-docs**: ClarityDoc comment parser, markdown/JSON generators, coverage analysis, doc stripping.

Key patterns to preserve:
- Plugin-based generation architecture in CLI
- Strict type narrowing from Clarity ABI → TypeScript
- Clear package boundaries (types has zero internal deps, docs depends on types, cli depends on both)
- Bun as runtime and package manager
</guide>

## Process

1. If `target` is provided, explore that file/directory only. Otherwise, map the full codebase structure (use Explore agent).
2. Understand current patterns, conventions, and architectural decisions before forming opinions.
3. Generate at least 3 candidate improvements internally.
4. Evaluate each against the criteria below.
5. Present only the final recommendation.

## What Qualifies

A "quality-of-life improvement" means:
- Reducing friction in common workflows
- Eliminating unnecessary complexity or redundancy
- Improving readability and maintainability
- Strengthening type safety or error handling
- Enhancing consistency across similar patterns
- Tightening the Clarity ABI → TypeScript generation pipeline

"Simple" means:
- Single focused PR
- Changes no more than 3 files (ideally 1-2)
- No new dependencies
- No public API contract changes
- Self-contained and non-breaking

## Rules

1. Analyze the target scope (or entire codebase if no target) before selecting
2. Select exactly ONE improvement—highest leverage meeting all constraints
3. If multiple seem equal, prefer smallest scope
4. If a critical bug is found, report it regardless of scope
5. No documentation-only changes unless they fix actual confusion
6. State assumptions explicitly
7. The improvement must be specific to Secondlayer—not generic TypeScript advice
8. Respect existing package boundaries (don't move things across packages without strong reason)

## Avoid

- Multiple competing suggestions
- Large refactors or breaking changes
- Generic advice applicable to any TypeScript project
- Theoretical improvements without concrete implementation paths
- Adding dependencies
- Changes that alter generated output contracts

## Output Format

```
## Improvement: [Title]

**Location**: [File path(s)]

**Current State**: [What exists and why it's suboptimal]

**Proposed Change**: [The improvement]

**Implementation**:
\`\`\`typescript
[Code example or diff]
\`\`\`

**Impact**:
- [Primary benefit]
- [Secondary benefit if applicable]

**Risk**: [None/Low/Medium + explanation]

**Effort**: [Scope estimate]
```
