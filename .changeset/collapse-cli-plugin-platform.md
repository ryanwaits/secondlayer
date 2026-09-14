---
"@secondlayer/cli": major
---

Remove the plugin API (`@secondlayer/cli/plugins`, `plugins: [clarinet()]`). Set `clarinet: true` (or options) on the config. `codegen contracts` still loads Clarinet simnet ABIs.
