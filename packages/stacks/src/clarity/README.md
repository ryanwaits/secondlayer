# Clarity

Clarity value constructors, serialization, and ABI type system.

## Constructing Values

```typescript
import { Cl } from "@secondlayer/stacks/clarity";

Cl.uint(100);                          // (uint u100)
Cl.int(-42);                           // (int -42)
Cl.bool(true);                         // true
Cl.principal("SP2J6...");              // (principal SP2J6...)
Cl.contractPrincipal("SP2J6...", "my-contract");
Cl.bufferFromAscii("hello");          // (buff 0x68656c6c6f)
Cl.bufferFromHex("deadbeef");
Cl.stringAscii("hello");              // (string-ascii "hello")
Cl.stringUtf8("hello");               // (string-utf8 u"hello")
Cl.none();                            // none
Cl.some(Cl.uint(42));                 // (some u42)
Cl.ok(Cl.uint(42));                   // (ok u42)
Cl.error(Cl.uint(1));                 // (err u1)
Cl.list([Cl.uint(1), Cl.uint(2)]);    // (list u1 u2)
Cl.tuple({ name: Cl.stringAscii("alice"), age: Cl.uint(30) });
```

## Serialization

```typescript
import { serializeCV, deserializeCV } from "@secondlayer/stacks/clarity";

const hex = serializeCV(Cl.uint(42));          // hex string
const value = deserializeCV(hex);               // ClarityValue
```

## Pretty Printing

```typescript
import { prettyPrint, cvToJSON, cvToValue } from "@secondlayer/stacks/clarity";

prettyPrint(Cl.uint(42));    // "u42"
cvToJSON(Cl.uint(42));       // { type: "uint", value: "42" }
cvToValue(Cl.uint(42));      // 42n
```

## JS Bridge

```typescript
import { jsToClarityValue, clarityValueToJS, isClarityValue } from "@secondlayer/stacks/clarity";

// Convert JS → Clarity using ABI type hints
const cv = jsToClarityValue("uint128", 42n);

// Pre-built ClarityValues pass through unchanged (escape hatch)
jsToClarityValue("uint128", Cl.uint(42n));

// Buffer args accept flexible inputs
const buff = { buff: { length: 34 } };
jsToClarityValue(buff, new Uint8Array([1, 2]));
jsToClarityValue(buff, "0xdeadbeef");                     // hex (0x optional)
jsToClarityValue(buff, { type: "ascii", value: "hi" });   // ascii | utf8 | hex

// Runtime CV guard
isClarityValue(Cl.uint(1n)); // true

// Convert Clarity → JS
const js = clarityValueToJS(abiType, cv);
```

## ABI Type System

```typescript
import type { TypedAbi, ContractTypes, AbiTypesOf } from "@secondlayer/stacks/clarity";
```

`sl contracts generate` emits named per-function type aliases plus a
`<Contract>Types` bundle, and brands the generated ABI const with
`TypedAbi<typeof abi, Types>`. The brand is a phantom property — zero runtime
cost — that brand-aware consumers (`getContract`) resolve via `AbiTypesOf` to
show the named aliases in hovers and errors. Un-branded `as const` ABIs keep
working through structural inference.

## Standard ABIs

```typescript
import { SIP010_ABI, SIP009_ABI, SIP013_ABI } from "@secondlayer/stacks/clarity";

// Use with getContract() for typed token interactions
const token = getContract({
  client,
  address: "SP2J6...",
  name: "my-token",
  abi: SIP010_ABI,
});
```
