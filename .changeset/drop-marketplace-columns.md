---
"@secondlayer/shared": patch
---

Drop the marketplace-era columns from `subgraphs` (`is_public`, `tags`, `description`, `forked_from_id`) via migration `0045`. The columns were added by `0022_marketplace` and have been unused since the marketplace feature was removed in 2.1.0. Types updated accordingly.
