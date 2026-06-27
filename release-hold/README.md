# release-hold

Changesets parked here are **intentionally withheld from the next release**.

`bun run version` only consumes top-level `.changeset/*.md`, so anything in this
directory is invisible to the release pipeline. Other packages' changesets release
normally; a parked one does not drag a version bump along with them.

## Currently parked

Nothing. (The Bitcoin SPV changeset that lived here was released in
`@secondlayer/stacks@2.9.0`/`2.9.1`; the `./bitcoin` module is published and
runtime-gated by `isClarity6Active`.)

## How to park / un-park a changeset

To park: move a generated `.changeset/*.md` into this directory
(`git mv .changeset/<file>.md release-hold/`). `bun run version` ignores it, so
other packages release without dragging the parked bump along.

To un-park:

```bash
git mv release-hold/<file>.md .changeset/
bun run version            # consumes it: version bump + CHANGELOG
# ...then the normal release flow (see /release): biome the package.jsons,
# commit "chore: version packages", publish.
```
