---
"@secondlayer/shared": minor
"@secondlayer/stacks": minor
"@secondlayer/subgraphs": minor
"@secondlayer/sdk": minor
"@secondlayer/cli": patch
---

`print_event` triggers and subgraph print sources take `where`: equality on top-level keys of the decoded print tuple, spelled as the contract prints them (`where: { signer: [...] }`). An array is any-of (max 20), keys AND (max 10). Values match the field's JSON form: principals `SP…`, uints as decimal strings, bools `"true"`/`"false"`, buffers `0x…`.

print_event `topic` now filters; before, it was ignored on webhooks and you received every print from the contract. (Production check at release prep: 0 active webhooks set `topic` on a `print_event` trigger.)

`deserializeCV` builds principals straight from their bytes instead of re-validating the address it just encoded, roughly halving decode time for principal-heavy values.
