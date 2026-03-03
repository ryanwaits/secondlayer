---
"@secondlayer/stacks": minor
---

Support all 9 Stacks transaction payload types in deserializer/serializer. Fixes "Unknown payload type: 4" error during genesis sync by adding Coinbase, CoinbaseToAltRecipient, PoisonMicroblock, TenureChange, and NakamotoCoinbase.
