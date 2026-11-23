---
"@secondlayer/stacks": patch
---

The WalletConnect pairing QR code now scans. The generator placed the second copy of its format information one module off, which shifted the data, and it left out the version information and the full alignment grid that versions 7 to 10 need. A pairing URI is version 8.
