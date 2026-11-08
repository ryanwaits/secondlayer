---
"@secondlayer/shared": patch
---

One network resolver (`stacksNetwork`, honouring `STACKS_NETWORK`) and one database URL resolution shared by migrations, leader election and every reader and writer. The API logs when `STACKS_NETWORK` disagrees with the network pinned in `instances`.
