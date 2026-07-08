---
"@secondlayer/subgraphs": patch
---

fix(subgraphs): resolve + validate webhook hostnames before egress, closing the DNS-rebinding SSRF gap (any resolved private/link-local address, incl. 169.254.169.254, is refused)
