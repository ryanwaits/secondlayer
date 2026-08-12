# Canonical archive — key ceremony runbook

How to establish and operate the archive's trust root. The verification code is
complete (`packages/shared/src/archive/key-registry.ts`, 13 fixtures); what
remains is a ceremony, and a ceremony done casually defeats the entire model.

Read the whole document before running any command. Steps 1–3 happen once and
are hard to undo correctly.

## Why this exists

Manifests are signed by an ONLINE key that lives on the publishing host, so it
carries every risk that host carries. The trust anchor is an OFFLINE ROOT key
that signs one thing: a registry naming which online keys are valid and when.

Two properties fall out, and both matter:

- A compromised publishing host **cannot nominate its own signer**, because
  consumers only trust keys the root vouched for.
- A leaked online key can be **revoked without waiting for consumers to
  upgrade**, by publishing a new registry marking it compromised.

## The status semantics (do not conflate these)

| Status | Meaning | Effect on already-signed objects |
|---|---|---|
| `active` | currently signing | valid |
| `retired` | rotated out normally | **still valid** for objects signed inside its validity window |
| `compromised` | key leaked or suspected | **all** its signatures rejected, including historical ones |

Retiring a key must never invalidate the history it signed — otherwise every
rotation destroys the archive. Marking a key compromised must invalidate that
history, because an attacker holding the key could have backdated anything.
Using `retired` for a leak, or `compromised` for a routine rotation, are both
serious errors.

## 1. Generate the root key (offline, once)

On a machine that is **not** the publishing host and ideally not networked:

```bash
openssl genpkey -algorithm ed25519 -out archive-root.key
openssl pkey -in archive-root.key -pubout -out archive-root.pub
```

- `archive-root.key` never leaves this machine. Not into R2, not into `.env`,
  not into a password manager that syncs to the publishing host, not into a
  terminal on a server, not into a chat message or an agent transcript.
- Back it up to at least two offline media stored separately. Losing it means
  you cannot rotate or revoke, and recovering requires re-pinning a new root in
  every released client — a breaking change for consumers.
- `archive-root.pub` is public. It gets pinned in client code.

## 2. Write and sign the initial registry

The registry names the currently-active online signing key. Today that is
`fHQWzs9ML2WIYakf` (the key that signed snapshot `7ca39e7c…`). Confirm before
trusting this document:

```bash
ssh app-server "docker exec secondlayer-indexer-1 bun -e '
const m = await (await fetch(\"<PUBLIC_BASE>/secondlayer/mainnet/canonical/v1/latest.json\")).json();
console.log(m.key_id);'"
```

Build `registry.json` with the online key's PEM and a `valid_from` **at or
before the earliest object it signed** — otherwise the registry retroactively
invalidates published manifests:

```json
{
  "schema_version": 1,
  "network": "mainnet",
  "updated_at": "<now ISO>",
  "keys": [
    {
      "key_id": "fHQWzs9ML2WIYakf",
      "public_key_pem": "<online public PEM>",
      "status": "active",
      "valid_from": "2026-08-01T00:00:00.000Z",
      "valid_until": null
    }
  ]
}
```

Sign it offline. The signature covers the registry minus `signature` and
`root_key_id` — the same envelope convention the manifests use, implemented by
`canonicalRegistryPayload()`:

```bash
bun -e '
import { canonicalRegistryPayload } from "@secondlayer/shared/archive/key-registry";
import { signEd25519, loadEd25519PrivateKey, ed25519KeyId } from "@secondlayer/shared/crypto/ed25519";
const reg = await Bun.file("registry.json").json();
const priv = await Bun.file("archive-root.key").text();
const pub = await Bun.file("archive-root.pub").text();
reg.signature = signEd25519(canonicalRegistryPayload(reg), loadEd25519PrivateKey(priv));
reg.root_key_id = ed25519KeyId(pub);
await Bun.write("registry.signed.json", JSON.stringify(reg, null, 2));
'
```

## 3. Publish and pin

Upload to `secondlayer/mainnet/canonical/v1/keys/registry.json`. Then pin the
root public key in client code so consumers have an anchor that does not come
from the same server as the data.

Verify end to end before announcing:

```bash
# a signed registry that names the live key, verified against the pinned root
sl verify --against <PUBLIC_BASE>/secondlayer/mainnet/canonical/v1/latest.json
```

## 4. Routine rotation

1. Generate a new online key on the publishing host; deploy it as the signer.
2. Offline: set the old key `status: "retired"`, `valid_until` = the moment it
   stopped signing. Add the new key `active`, `valid_from` = the moment it
   started. **The windows must not overlap-gap**: any object signed between
   them verifies against neither key.
3. Re-sign the registry with the root and publish.

Historical manifests keep verifying. That is the point.

## 5. Compromise response

Speed matters more than tidiness here.

1. Offline: mark the key `status: "compromised"`, set `compromised_at`.
2. Re-sign and publish the registry **first** — this is what actually revokes.
3. Rotate to a fresh online key (step 4).
4. Re-export and re-sign every snapshot the compromised key signed, then
   re-promote `latest.json`. Until this is done, consumers correctly reject the
   archive; that is the system working, not a bug to route around.
5. Publish an incident writeup under `reports/incidents/`.

Never "recover" by marking the key `retired` to keep history verifying. That
silently re-accepts anything the attacker signed.

## 6. Lost root key

There is no clean recovery — this is why step 1's backups matter.

1. Generate a new root offline.
2. Publish a registry signed by the new root.
3. Ship a client release pinning the new root public key.
4. Announce it out of band. Consumers on older clients will reject the archive
   until they upgrade, and that is correct: from their perspective an unknown
   root is indistinguishable from an attacker's.

## What is code-complete vs ceremony-pending

| Piece | State |
|---|---|
| Registry verification, status semantics, validity windows | done, 13 fixtures |
| CLI resolves keys through a registry when published | done, falls back when absent |
| Root key generated, registry published, root pinned in clients | **pending — this runbook** |

Until step 3 lands, `sl verify` verifies manifests against a signing key served
over HTTPS. That proves the key the endpoint chose, not the key the root
approved.
