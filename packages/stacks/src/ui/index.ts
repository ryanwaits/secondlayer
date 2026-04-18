/**
 * Stacks UI atoms for json-render catalogs.
 *
 * These are reusable building blocks authors compose into their own
 * json-render catalog when calling `step.render(id, catalog, opts)`.
 *
 * Usage:
 *
 *   import { defineCatalog, schema, atoms } from "@secondlayer/stacks/ui"
 *   import { z } from "zod"
 *
 *   const whaleUI = defineCatalog(schema, {
 *     components: {
 *       Address: atoms.Address,
 *       Amount: atoms.Amount,
 *       WhaleCard: {
 *         props: z.object({ from: z.string(), amount: z.string() }),
 *         render: WhaleCard,
 *       },
 *     },
 *     actions: {},
 *   })
 *
 * Re-exports `defineCatalog` + the React `schema` from `@json-render/*` so
 * users only import from one place.
 */

export { defineCatalog } from "@json-render/core";
export { schema } from "@json-render/react";

import { AddressComponent } from "./atoms/address.tsx";
import { AmountComponent } from "./atoms/amount.tsx";
import { BlockHeightComponent } from "./atoms/blockHeight.tsx";
import { BnsNameComponent } from "./atoms/bnsName.tsx";
import { NftAssetComponent } from "./atoms/nftAsset.tsx";
import { PrincipalComponent } from "./atoms/principal.tsx";
import { TokenComponent } from "./atoms/token.tsx";
import { TxStatusComponent } from "./atoms/txStatus.tsx";

export const atoms = {
	Address: AddressComponent,
	Amount: AmountComponent,
	BlockHeight: BlockHeightComponent,
	BnsName: BnsNameComponent,
	NftAsset: NftAssetComponent,
	Principal: PrincipalComponent,
	Token: TokenComponent,
	TxStatus: TxStatusComponent,
} as const;

// Named exports for direct import (e.g. `import { Address } from "@secondlayer/stacks/ui"`)
export { Address, AddressProps } from "./atoms/address.tsx";
export { Amount, AmountProps } from "./atoms/amount.tsx";
export { BlockHeight, BlockHeightProps } from "./atoms/blockHeight.tsx";
export { BnsName, BnsNameProps } from "./atoms/bnsName.tsx";
export { NftAsset, NftAssetProps } from "./atoms/nftAsset.tsx";
export { Principal, PrincipalProps } from "./atoms/principal.tsx";
export { Token, TokenProps } from "./atoms/token.tsx";
export { TxStatus, TxStatusProps } from "./atoms/txStatus.tsx";

export { atomComponentMap } from "./componentMap.tsx";
