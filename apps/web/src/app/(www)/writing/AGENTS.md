# Writing posts

Rules for drafting and editing posts under `(post)/<slug>/page.mdx`. Figures:
`components/figures/FIGURES.md`. Code annotations: DESIGN.md §2, Code surfaces.

## The ladder

Use the plainest treatment that makes the point. Each step up needs a reason
you can say in one sentence.

| Treatment | Per post | Use it when |
| --- | --- | --- |
| Prose, a link, italic | any | almost always |
| `<ChainLink>` | first mention per chain | the chain or language is part of the point |
| Plain fence | any | real code or a payload the reader could copy |
| `<Sidenote>` | ≤ 3 | precision the argument doesn't need |
| Annotated fence (`!callout`, `!mark`) | ≤ 3 callouts per fence | the paragraph points at a token or line |
| `[text](hover:name)` | ≤ 2 names | prose names a field in the code beside it |
| `<FigShell>` figure | ≤ 3, one per `##` | the shape is the point: position, asymmetry, tradeoff |
| Explorer (D-tier) | ≤ 1 | the central idea changes with a parameter |

## Rules

Numbered to match the Writing Kit (claude.ai/artifact/S5Y12FUvHoSdQ6F6grz7UR),
which shows each one as a before and after from a real post.

- **R1. Use the lowest step on the ladder that makes the point.** Each richer
  treatment needs a reason you can say in one sentence.
- **R2. Up to 3 figures, at most one per `##`, at most one set piece.** The set
  piece is an explorer (D-tier). No `<CodeSteps>` in posts: three callouts on
  one fence do the same job for less attention.
- **R3. A figure never repeats what the text or code already says.** Facts
  about code go on the code as callouts. A chart whose bars are all equal is a
  sentence.
- **R4. The hero fence gets a file title and up to 3 callouts. Other fences
  stay plain** unless the paragraph points at a token. The callouts answer the
  claims in the paragraph after the fence.
- **R5. Yellow marks the one token the paragraph is about.** One `!mark` per
  fence by default. Blue is links only, red is failures only.
- **R6. Chip a chain or language once, on first mention, and only if the post
  is about it.** Plain words after that. Link a chip only to our own page.
  Chips: stacks, bitcoin, sbtc, clarity, runes, robinhood (Robinhood Chain).
- **R7. Sidenotes hold precision, never the argument.** At most 3. If the
  reader needs it to follow along, it goes in the body.
- **R8. Prose mentions (`[text](hover:name)`) only when the code sits beside
  them.** At most 2 names per post.
- **R9. Roadmaps show direction, not dates.** `<Roadmap>`: ink = shipped,
  yellow = next, outline = later. An unshipped step is never shown as done;
  pending grants and partners are named as pending. Sizes and costs stay
  qualitative ("fits in one transaction") until measured on mainnet.
- **R10. Real output only.** Transcripts, heights and counts come from a real
  run, and the checklist below passes before a post ships.

- **R11. Titles name the reader's problem or the finding.** Specific nouns,
  a number if there is one. Never a clever title that needs the post to make
  sense ("Where the trust goes" became "An index you can check, starting
  with a bridge").
- **R12. The dek is one sentence of 30 words or fewer: the claim and who it's
  for.** No colon followed by a reveal.
- **R13. The first two sentences carry the event and the stakes.** No setup
  paragraph, no fragment runs ("The contract works. The wallet connects."),
  and the post never talks about itself ("This post covers…").
- **R14. Headings state findings** ("The checkpoint is a receipt", not
  "Receipts and bookmarks"). Cut any section's last sentence that restates
  it, teases the next one or moralizes.
- **R15. 900 words or fewer, 6 minutes or less.** Past that, every extra 300
  words needs its own figure or code. End on the action (a command, a link),
  never on what the post skipped.

## Slop lint

Most hits land where readers skim, so read these on their own, cold: the
title, the dek, every `##`, the first two sentences, and each section's last
sentence. Rewrite each hit; don't soften it.

| Pattern | Example to cut |
| --- | --- |
| Fragment runs and one-line dramatic paragraphs | "Their deposits. Their position. Their share." |
| Contrast framing | "It isn't X. It's Y.", "not just X but Y" |
| Groups of three for rhythm | "fast, simple, yours" |
| Summary or moral closers | "Anyway: next time…", "Overall…" |
| Inflated significance | "the payoff is bigger than…", "pivotal" |
| Talking about the post | "This post covers…", "There's a lot I've skipped" |
| Stock phrases | "delve", "it's important to note", "a testament to" |
| "honest" as a credibility word | "the honest version", "to be honest about" |
| A phrase reused from a sibling post | grep the other posts before shipping |

Every number or claim needs its evidence in the post (a command, a count, a
link), or it goes.

## Before a post ships

- `POSTS` entry in `lib/writing.ts`: title (R11), dek (R12), `readingTime`,
  `status: "draft"` until reviewed. The rail lists sections and figures from
  the page itself.
- No em dashes. Slop lint passes. Prose word count ≤ 900.
- `bun test` (annotation budgets), light + dark screenshots at desktop and 390px.
- `bun run og` after any title or code change; delete the old card when a
  slug changes. The share card is the title beside up to 7 lines of the post's
  first code block of 4+ lines, centered on its first `!mark` or `!callout`
  (a transcript keeps its command and result). Put the hero fence first.
