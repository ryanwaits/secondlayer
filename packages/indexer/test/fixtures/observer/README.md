SBA-shaped `/new_block` bodies for export contract tests.

Hash file bytes, not re-serialized JSON. Do not canonicalize keys.
Dual time keys (`timestamp` vs `burn_block_time`) are the point.

`new_block.star.json` is a `"*"` body: no `vm_events` field.
`new_block.vm_events.json` is the opt-in body (`"storage"` + `"contract_calls"`):
`map_set_event` + `contract_call_event`, `vm_event_index`, no `event_index` on traces.
