import { z } from "zod";

/**
 * Account profile shapes for the metered-archive account surface
 * (display_name, bio, notification toggle). The hosted-console `slug`
 * field died with the public directory (gate-g Slice D).
 */

export interface UpdateProfileRequest {
	display_name?: string;
	bio?: string;
	/** Opt-out toggle for the subgraph reindex-completion email. */
	notify_reindex_complete?: boolean;
}

export const UpdateProfileRequestSchema: z.ZodType<UpdateProfileRequest> =
	z.object({
		display_name: z.string().max(50).optional(),
		bio: z.string().max(300).optional(),
		notify_reindex_complete: z.boolean().optional(),
	});
