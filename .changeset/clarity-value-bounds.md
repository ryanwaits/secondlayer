---
"@secondlayer/stacks": patch
---

Clarity values are checked where they are built and written: `serializeCV` refuses a uint outside u128 or an int outside i128, `stringAsciiCV` refuses non-ASCII characters and strings past 1 MB, `hexToBytes` rejects a string that is not hex (it read `1g` as `1`), and `intToBigInt("")` throws instead of returning 0.
