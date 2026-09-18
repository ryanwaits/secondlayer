SBA-shaped `/new_block` bodies for export contract tests.

Hash file bytes, not re-serialized JSON. Do not canonicalize keys.
Dual time keys (`timestamp` vs `burn_block_time`) are the point.

`new_block.star.json` is a `"*"` body: no `vm_events` field.
`new_block.vm_events.json` is the opt-in body (`"storage"` + `"contract_calls"`):
`map_set_event` + `contract_call_event`, `ordinal`, no `event_index` on traces.
`new_block.vm_events.empty.json` is opt-in with `"vm_events": []` (not omitted).
`new_block.vm_events.all_types.json` is all five node types; `ordinal` 1 is
a gap (storage/calls filter); `sender` is null on the nested call.
