# Secondlayer Signer — Railway template

One-click deploy of a Secondlayer workflow signer. Your private key lives in Railway env vars; Secondlayer never sees it.

## Deploy

1. Push this folder to a GitHub repo
2. Create a new Railway project from the repo
3. Set env vars:
   - `STACKS_PRIVATE_KEY` — your Stacks private key (hex)
   - `SECONDLAYER_HMAC` — shared secret (generate with `openssl rand -hex 32`)
   - `DAILY_CAP_MICROSTX` — optional, defaults to 1 STX/day
4. Deploy. Railway assigns a URL like `https://your-signer.railway.app`
5. Health-check: `curl https://your-signer.railway.app/health` → returns `{ ok, publicKey, address }`

## Wire into your workflow

```ts
import { defineWorkflow, signer } from "@secondlayer/workflows"

export default defineWorkflow({
  name: "dca",
  trigger: { type: "schedule", cron: "0 0 * * *" },
  signers: {
    treasury: signer.remote({
      endpoint:  "https://your-signer.railway.app/sign",
      publicKey: "<copy from /health>",
      hmacRef:   "treasury-hmac",
    }),
  },
  handler: async ({ step }) => { /* ... */ },
})
```

Store the HMAC secret in Secondlayer so the runner can authenticate requests:

```bash
sl secrets set treasury-hmac $SECONDLAYER_HMAC
```

## Customize the policy

Edit `src/server.ts`. The reference service ships with `allowlistFunctions` + `dailyCapMicroStx`. Add `requireApproval({ webhook })` to route every sign request through a human approval step, or write your own policy following the `Policy` type from `@secondlayer/signer-node/policy`.
