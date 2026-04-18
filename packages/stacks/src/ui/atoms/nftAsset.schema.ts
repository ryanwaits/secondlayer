import { z } from "zod";

export const NftAssetProps = z.object({
	assetIdentifier: z
		.string()
		.describe("Full asset identifier (e.g. SP123.contract::asset-name)"),
	tokenId: z
		.string()
		.describe("Token id (as string to preserve bigint precision)"),
	name: z.string().nullable().optional(),
	imageUrl: z.string().url().nullable().optional(),
});

export type NftAssetPropsType = z.infer<typeof NftAssetProps>;
