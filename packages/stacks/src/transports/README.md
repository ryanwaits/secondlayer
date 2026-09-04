# Transports

Transport layer for communicating with Stacks nodes.

## HTTP (Default)

```typescript
import { http } from "@secondlayer/stacks";

// Uses chain's default RPC URL
const transport = http();

// Custom URL
const transport = http("https://my-node.example.com");

// With options
const transport = http("https://my-node.example.com", {
  apiKey: "my-api-key",
  timeout: 30_000,
  retryCount: 3,
  retryDelay: 1_000,
});
```

Non-2xx responses throw a typed `HttpRequestError` (`.status` attached) instead of resolving with the error body — check `e.status` rather than reading `client.request(...)`'s return value for failure. Retries cover `5xx`, network errors, and `429`.

## WebSocket

```typescript
import { webSocket } from "@secondlayer/stacks";

const transport = webSocket();

// Custom URL
const transport = webSocket("wss://my-node.example.com");
```

## Fallback

Tries transports in order, falls back on failure.

```typescript
import { fallback, http } from "@secondlayer/stacks";

const transport = fallback([
  http("https://primary-node.com"),
  http("https://backup-node.com"),
]);
```

## Simnet

Separate entry. `@stacks/clarinet-sdk` is an optional peer of that entry only.

```typescript
import { initSimnet } from "@stacks/clarinet-sdk";
import { createPublicClient } from "@secondlayer/stacks";
import { simnet, simnetChain } from "@secondlayer/stacks/simnet";

const session = await initSimnet("./Clarinet.toml");
const client = createPublicClient({
  chain: simnetChain,
  transport: simnet(session),
});
```

## Custom

```typescript
import { custom } from "@secondlayer/stacks";

const transport = custom({
  async request(path, options) {
    const response = await fetch(`https://my-api.com${path}`, {
      method: options?.method ?? "GET",
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return response.json();
  },
});
```
