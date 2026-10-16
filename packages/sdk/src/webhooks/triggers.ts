export {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
} from "@secondlayer/shared/schemas/chain-triggers";
export type { ChainTriggerType } from "@secondlayer/shared/schemas/chain-triggers";

/**
 * Its own subpath, not the main `@secondlayer/sdk` barrel: that barrel's
 * runtime code (unlike a `type` import, which is erased) drags in
 * `@secondlayer/shared`'s DB layer — and `postgres`, a Node-only driver —
 * into a client component's bundle. `CHAIN_TRIGGER_FIELDS` is the config
 * card's per-trigger-type field list, a literal checked against the Zod schema
 * in shared's tests so it can't drift behind it. The `chain-triggers` subpath
 * is zod-free, which keeps zod out of the client bundle.
 */
