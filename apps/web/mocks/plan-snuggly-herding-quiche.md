# Gate Login Behind Waitlist Approval

## Context

Login currently creates accounts for anyone (`upsertAccount` on verify). We want to gate access: only existing accounts and approved waitlist users can log in. Unknown/pending users get the same "check your email" response but no email is sent (no info leak). Login page gets disclaimer copy directing unapproved users to "Get early access".

---

## Sprint 1: Backend — waitlist status + login gate

- [ ] **T1**: Migration `0010_waitlist_status.ts` — add `status text not null default 'pending'` to `waitlist`. Existing rows backfilled to `pending`.
  - File: `packages/shared/migrations/0010_waitlist_status.ts`
  - Pattern: follows `0009_waitlist.ts` style
  → validates: `bun run migrate` succeeds; `SELECT status FROM waitlist LIMIT 1` returns `pending`

- [ ] **T2**: Update `WaitlistTable` type — add `status: Generated<string>`
  - File: `packages/shared/src/db/types.ts`
  → validates: `tsc --noEmit`

- [ ] **T3**: Add `isEmailAllowed(db, email)` query — returns true if email in `accounts` OR in `waitlist` with `status = 'approved'`
  - File: `packages/shared/src/db/queries/accounts.ts`
  - Single query: `SELECT 1 FROM accounts WHERE email = ? UNION ALL SELECT 1 FROM waitlist WHERE email = ? AND status = 'approved' LIMIT 1`
  → validates: `tsc --noEmit`

- [ ] **T4**: Gate magic-link route — call `isEmailAllowed` before creating token. Not allowed → return same 200, skip token creation + email send.
  - File: `packages/api/src/routes/auth.ts` (magic-link handler)
  → validates: unapproved email returns 200 but no email sent; approved/existing account gets code

- [ ] **T5**: Gate verify route — after `verifyMagicLink`, call `isEmailAllowed`. Not allowed → throw `ValidationError("Invalid or expired token")`.
  - File: `packages/api/src/routes/auth.ts` (verify handler)
  → validates: valid token for unapproved email still rejected

## Sprint 2: Frontend — login page disclaimer

- [ ] **T6**: Add disclaimer text below login form + below "check your email" view
  - File: `apps/web/src/app/login/page.tsx`
  - Email step: disclaimer below submit button — "You'll receive a code if you have an account or approved early access. Otherwise, join the early access list."
  - Verify step: same or similar hint
  - Style: muted, small text, link "early access" to scroll-to or auth-bar CTA
  → validates: visual check on `/login`

- [ ] **T7**: Add disclaimer CSS
  - File: `apps/web/src/app/globals.css`
  → validates: build passes

---

## Dependency Graph

```
T1 → T2 → T3 → T4, T5 (parallel)
T4, T5 → T6, T7 (parallel)
```

## Key Files

| File | Action |
|---|---|
| `packages/shared/migrations/0010_waitlist_status.ts` | CREATE |
| `packages/shared/src/db/types.ts` | MODIFY (WaitlistTable) |
| `packages/shared/src/db/queries/accounts.ts` | MODIFY (add isEmailAllowed) |
| `packages/api/src/routes/auth.ts` | MODIFY (gate magic-link + verify) |
| `apps/web/src/app/login/page.tsx` | MODIFY (disclaimer copy) |
| `apps/web/src/app/globals.css` | MODIFY (disclaimer styles) |

## Reuse

- `getDb()` from `@secondlayer/shared/db`
- `ValidationError` from `@secondlayer/shared/errors`
- Existing `upsertAccount`, `createMagicLink`, `verifyMagicLink` unchanged
- Existing waitlist POST route unchanged (inserts with default `status = 'pending'`)

## Design Decisions

- **Double gate** (magic-link + verify) — defense in depth
- **Same 200 on gated magic-link** — no email enumeration
- **No approval endpoint yet** — manual SQL for wave approvals (`UPDATE waitlist SET status = 'approved' WHERE email IN (...)`)
- **No approval notification email yet** — future follow-up

## Unresolved

1. **Approval notification email** — when you approve a wave, send email telling them they can now log in? (follow-up sprint)
2. **Admin approval endpoint** — `PATCH /api/waitlist/approve` with email list? Or manual SQL for now?
3. **Disclaimer copy** — exact wording TBD, will iterate on frontend
