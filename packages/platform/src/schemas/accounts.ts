import { z } from "zod";

export interface UpdateProfileRequest {
	display_name?: string;
	bio?: string;
	notify_reindex_complete?: boolean;
}

export const UpdateProfileRequestSchema: z.ZodType<UpdateProfileRequest> =
	z.object({
		display_name: z.string().max(50).optional(),
		bio: z.string().max(300).optional(),
		notify_reindex_complete: z.boolean().optional(),
	});
