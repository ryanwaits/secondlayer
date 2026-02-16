# Utils

Encoding, hashing, address, and unit conversion utilities.

## Encoding

```typescript
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from "@secondlayer/stacks/utils";

bytesToHex(new Uint8Array([0xde, 0xad])); // "dead"
hexToBytes("deadbeef");                    // Uint8Array
utf8ToBytes("hello");                      // Uint8Array
bytesToUtf8(bytes);                        // "hello"
```

## Hashing

```typescript
import { sha256, hash160, ripemd160 } from "@secondlayer/stacks/utils";

const h = sha256(data);      // Uint8Array (32 bytes)
const h160 = hash160(data);  // Uint8Array (20 bytes) — SHA-256 + RIPEMD-160
```

## Addresses

```typescript
import {
  c32address,
  c32addressDecode,
  validateStacksAddress,
  parseContractId,
} from "@secondlayer/stacks/utils";

const addr = c32address(22, hash160Bytes); // "SP2J6..."
const [version, hash] = c32addressDecode("SP2J6...");

validateStacksAddress("SP2J6...");  // true
parseContractId("SP2J6....my-contract"); // { address: "SP2J6...", name: "my-contract" }
```

## Units

```typescript
import { formatStx, parseStx, formatUnits, parseUnits } from "@secondlayer/stacks/utils";

formatStx(1_000_000n);   // "1.0"
parseStx("1.5");          // 1_500_000n

formatUnits(1000n, 6);    // "0.001"
parseUnits("0.001", 6);   // 1000n
```

## Signatures

```typescript
import { verifyMessageSignature, recoverPublicKey } from "@secondlayer/stacks/utils";

const valid = verifyMessageSignature({
  message: "Hello",
  signature: "0x...",
  publicKey: "03ab...",
});

const pubkey = recoverPublicKey(hash, signature);
```
