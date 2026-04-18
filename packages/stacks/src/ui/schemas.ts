/**
 * React-free Zod schemas for Stacks UI atoms, plus a pass-through
 * `defineCatalog` helper.
 *
 * Import from this module when writing a workflow handler that uses
 * `step.render` — you avoid pulling React and `@json-render/*` into the
 * bundled handler (which would duplicate Zod and break esbuild's util
 * scoping). The runner wraps the raw definition into a real json-render
 * `Catalog` at render time using its own `@json-render/*` install.
 *
 * @example
 *
 *   import { defineCatalog, AddressProps, AmountProps } from "@secondlayer/stacks/ui/schemas"
 *   import { z } from "zod"
 *
 *   const whaleUI = defineCatalog({
 *     components: {
 *       Address: { props: AddressProps },
 *       Amount:  { props: AmountProps },
 *       WhaleCard: {
 *         props: z.object({ from: z.string(), amount: z.string() }),
 *       },
 *     },
 *     actions: {},
 *   })
 *
 *   // ...inside a workflow handler:
 *   await step.render("card", whaleUI, { model, prompt, context })
 */

export {
	AddressProps,
	type AddressPropsType,
} from "./atoms/address.schema.ts";
export { AmountProps, type AmountPropsType } from "./atoms/amount.schema.ts";
export {
	BlockHeightProps,
	type BlockHeightPropsType,
} from "./atoms/blockHeight.schema.ts";
export { BnsNameProps, type BnsNamePropsType } from "./atoms/bnsName.schema.ts";
export {
	NftAssetProps,
	type NftAssetPropsType,
} from "./atoms/nftAsset.schema.ts";
export {
	PrincipalProps,
	type PrincipalPropsType,
} from "./atoms/principal.schema.ts";
export { TokenProps, type TokenPropsType } from "./atoms/token.schema.ts";
export {
	TxStatusProps,
	type TxStatusPropsType,
} from "./atoms/txStatus.schema.ts";

import type { z } from "zod";
import { AddressProps } from "./atoms/address.schema.ts";
import { AmountProps } from "./atoms/amount.schema.ts";
import { BlockHeightProps } from "./atoms/blockHeight.schema.ts";
import { BnsNameProps } from "./atoms/bnsName.schema.ts";
import { NftAssetProps } from "./atoms/nftAsset.schema.ts";
import { PrincipalProps } from "./atoms/principal.schema.ts";
import { TokenProps } from "./atoms/token.schema.ts";
import { TxStatusProps } from "./atoms/txStatus.schema.ts";

/**
 * Atom-schema registry — ready to drop into a catalog's `components` field.
 */
export const atomSchemas: Record<string, { props: z.ZodTypeAny }> = {
	Address: { props: AddressProps },
	Amount: { props: AmountProps },
	BlockHeight: { props: BlockHeightProps },
	BnsName: { props: BnsNameProps },
	NftAsset: { props: NftAssetProps },
	Principal: { props: PrincipalProps },
	Token: { props: TokenProps },
	TxStatus: { props: TxStatusProps },
};

// --- Raw catalog definition shape (wrapped into a Catalog at render time) ---

/**
 * Raw catalog definition — a plain object mapping component names to their
 * prop schemas. The workflow runner wraps this into a `@json-render/core`
 * `Catalog` via its own install, keeping json-render out of the user bundle.
 */
export interface RawCatalogDefinition {
	components: Record<string, { props: unknown }>;
	actions?: Record<string, { params?: unknown }>;
}

/**
 * Identity helper — exists so authors get IDE autocomplete and so the
 * migration story to a real catalog constructor stays open. Does not import
 * `@json-render/*`, so nothing React-flavored bundles into the handler.
 */
export function defineCatalog<T extends RawCatalogDefinition>(def: T): T {
	return def;
}
