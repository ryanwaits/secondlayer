---
"@secondlayer/subgraphs": patch
---

Adds long-poll tracing fields to the `chain_evaluator_tick` log (`wait_requested`, `known_height`, `wait_ms`, `wait_outcome`) so a residual decoder-committed-to-outbox tail can be classified after the fact instead of guessed at: whether the tick asked to long-poll, the baseline height it sent, how long that fetch took, and why it returned (tip moved, timed out, or the server was already found not to support wait).
