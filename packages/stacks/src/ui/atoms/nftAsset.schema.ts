import { z } from "zod";

export interface NftAssetPropsType {
	assetIdentifier: string;
	tokenId: string;
	name?: string | null | undefined;
	imageUrl?: string | null | undefined;
}

export const NftAssetProps: z.ZodTypeAny = z.object({
	assetIdentifier: z
		.string()
		.describe("Full asset identifier (e.g. SP123.contract::asset-name)"),
	tokenId: z
		.string()
		.describe("Token id (as string to preserve bigint precision)"),
	name: z.string().nullable().optional(),
	imageUrl: z.string().url().nullable().optional(),
});
