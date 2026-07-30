---
"@secondlayer/api": patch
---

The deploy-time print-field lint is promoted from a warning to a refusal when the source declares a `prints` map. Declaring the schema is an explicit claim about the payload shape, so a handler reading a field no observed event carries is a defect, not a hint — refusing the deploy (`422 PRINT_FIELD_MISMATCH`) beats shipping a subgraph that writes nulls for its entire lifetime. Sources without a `prints` declaration keep the advisory warning behavior.
