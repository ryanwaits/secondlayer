# release-hold

Changesets parked here are **intentionally withheld from the next release**.

`bun run version` only consumes top-level `.changeset/*.md`, so anything in this
directory is invisible to the release pipeline. Other packages' changesets release
normally; a parked one does not drag a version bump along with them.

## Currently parked

### `bitcoin-spv-module.md` — `@secondlayer/stacks` minor

The Bitcoin SPV module (`@secondlayer/stacks/bitcoin`, SIP-044). Held until
**Stacks Epoch 4.0 / Clarity 6 activates** — that's the announcement moment we
want the `@secondlayer/stacks` minor + CHANGELOG entry timed to.

**Note (not a blocker):** the module *code* is already on `main` and exported at
`./bitcoin`, so it ships in the built tarball whenever `@secondlayer/stacks` next
publishes for any reason. That's fine — it's runtime-gated (`isClarity6Active`)
and documented as Epoch-4.0-gated. Parking controls *version attribution +
announcement*, not code presence.

## Un-park at activation

```bash
git mv release-hold/bitcoin-spv-module.md .changeset/
bun run version            # bumps @secondlayer/stacks minor + writes CHANGELOG
# ...then the normal release flow (see /release): biome the package.jsons,
# commit "chore: version packages", publish.
```
