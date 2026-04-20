import { z } from "zod/v4";

/**
 * Account profile shapes. Unrelated to marketplace — previously lived in
 * schemas/marketplace.ts alongside public-directory types. Kept here now
 * that marketplace is gone so the profile fields (display_name, bio, slug)
 * have a stable home.
 */

export interface UpdateProfileRequest {
	display_name?: string;
	bio?: string;
	slug?: string;
}

export const UpdateProfileRequestSchema: z.ZodType<UpdateProfileRequest> =
	z.object({
		display_name: z.string().max(50).optional(),
		bio: z.string().max(300).optional(),
		slug: z
			.string()
			.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
			.min(3)
			.max(30)
			.optional(),
	});
